import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

function load(file, deps, extra = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, ...extra, require(key) { if (key in deps) return deps[key]; throw Error("Unexpected dependency " + key); } });
  return module.exports;
}
const wallet = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
const analysis = load("../app/server/wallet-analysis.ts", { bs58 });
const signatures = (...values) => values.map(signature => ({ signature, blockTime: 100, err: null }));
function harness(t, configured = true) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE settings(owner TEXT,key TEXT,value TEXT,PRIMARY KEY(owner,key)); CREATE TABLE secrets(owner TEXT,provider TEXT);");
  if (configured) db.prepare("INSERT INTO secrets VALUES('owner','rpc')").run();
  let clock = Date.now(), sequence = 0;
  class Clock extends Date { static now() { return clock; } }
  const state = { page: signatures("base"), tx: signature => ({ transaction: { signatures: [signature], message: { accountKeys: [] } }, meta: {}, blockTime: 100 }), calls: [], failBatch: false };
  const prepare = sql => ({ bind: (...args) => ({ sql, args }) });
  const core = {
    AppError: Error, now: () => new Date(clock).toISOString(), id: () => "lease-" + ++sequence,
    one: async (sql, ...args) => db.prepare(sql).get(...args), rows: async (sql, ...args) => db.prepare(sql).all(...args),
    change: async (sql, ...args) => ({ meta: { changes: db.prepare(sql).run(...args).changes } }),
    setting: async (owner, key, fallback) => { const row = db.prepare("SELECT value FROM settings WHERE owner=? AND key=?").get(owner, key); return row ? JSON.parse(row.value) : fallback; },
    db: () => ({ prepare, batch: async statements => {
      if (state.failBatch) { state.failBatch = false; throw Error("Injected persistence failure"); }
      db.exec("BEGIN"); try { const out = statements.map(s => db.prepare(s.sql).run(...s.args)); db.exec("COMMIT"); return out; } catch (error) { db.exec("ROLLBACK"); throw error; }
    } }),
    rpc: async (owner, method, args) => { assert.equal(owner, "owner"); state.calls.push({ method, args }); return method === "getSignaturesForAddress" ? typeof state.page === "function" ? state.page(args[1]) : state.page : state.tx(args[0]); },
  };
  const signals = load("../app/server/signals.ts", { "./core": core, "./wallet-analysis": analysis, "./twitter-provider": {}, "@solana/web3.js": { PublicKey }, bs58 });
  const api = load("../app/server/wallet-live.ts", { "./core": core, "./wallet-analysis": analysis, "./signals": signals, "@solana/web3.js": { PublicKey }, bs58 }, { Date: Clock, AbortSignal });
  return { db, api, state, next: () => { clock += 10001; }, cursor: () => JSON.parse(db.prepare("SELECT value FROM settings WHERE owner='owner' AND key='bwa_live_state'").get().value), count: () => db.prepare("SELECT count(*) AS n FROM settings WHERE owner='owner' AND key LIKE 'bwa_live_tx_%'").get().n };
}
test("live monitoring requires a saved RPC and cannot expose another owner's records", async t => {
  const h = harness(t, false); const result = await h.api.refreshWalletLive("owner");
  assert.equal(result.status, "needs_rpc"); assert.equal(h.state.calls.length, 0);
  h.db.prepare("INSERT INTO settings VALUES('other','bwa_live_tx_foreign',?)").run(JSON.stringify({ signature: "secret-other" }));
  assert.equal((await h.api.readWalletLive("owner")).items.length, 0);
});
test("bursts paginate to the old anchor before advancing and duplicate pages retain one row per signature", async t => {
  const h = harness(t); await h.api.refreshWalletLive("owner"); h.next();
  const burst = Array.from({ length: 113 }, (_, i) => "new-" + i);
  h.state.page = args => args.before ? signatures(...burst.slice(100), "base") : signatures(...burst.slice(0, 100));
  await h.api.refreshWalletLive("owner"); assert.equal(h.cursor().anchor, "base"); assert.equal(h.cursor().before, "new-99");
  h.next(); await h.api.refreshWalletLive("owner"); assert.equal(h.cursor().anchor, "new-0"); assert.equal(h.cursor().before, null); assert.equal(h.count(), 114);
  h.next(); h.state.page = signatures("new-0", "new-1"); await h.api.refreshWalletLive("owner"); assert.equal(h.count(), 114);
});
test("unavailable transaction details persist and retry without becoming a trade", async t => {
  const h = harness(t); h.state.tx = () => null;
  let result = await h.api.refreshWalletLive("owner"); assert.equal(result.pending, 1); assert.equal(result.items[0].status, "pending");
  h.next(); h.next(); h.state.tx = signature => ({ transaction: { signatures: [signature], message: { accountKeys: [] } }, meta: {}, blockTime: 100 });
  result = await h.api.refreshWalletLive("owner"); assert.equal(result.pending, 0); assert.equal(result.items[0].action, "Unclassified transaction");
});
test("overlapping polls share a lease and cannot issue duplicate discovery requests", async t => {
  const h = harness(t); let release; h.state.page = () => new Promise(resolve => { release = resolve; });
  const first = h.api.refreshWalletLive("owner");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await h.api.refreshWalletLive("owner"); assert.equal(h.state.calls.length, 1);
  release(signatures("base")); await first;
  await h.api.refreshWalletLive("owner"); assert.equal(h.state.calls.filter(x => x.method === "getSignaturesForAddress").length, 1);
});
test("failed atomic page save never advances past undelivered history", async t => {
  const h = harness(t); await h.api.refreshWalletLive("owner"); h.next();
  h.state.page = signatures("new", "base"); h.state.failBatch = true;
  await h.api.refreshWalletLive("owner"); assert.equal(h.cursor().anchor, "base"); assert.equal(h.count(), 1); assert.ok(h.cursor().error);
  h.next(); await h.api.refreshWalletLive("owner"); assert.equal(h.cursor().anchor, "new"); assert.equal(h.count(), 2);
});
test("missing history boundaries remain visible while later updates can continue", async t => {
  const h = harness(t); await h.api.refreshWalletLive("owner"); h.next(); h.state.page = signatures("disconnected");
  let result = await h.api.refreshWalletLive("owner"); assert.equal(result.status, "gap"); assert.match(result.gap, /gap/);
  h.next(); h.state.page = signatures("latest", "disconnected"); result = await h.api.refreshWalletLive("owner");
  assert.equal(h.cursor().anchor, "latest"); assert.equal(result.status, "gap"); assert.equal(h.count(), 3);
});
test("actual archived actions decode launch, partial sale, full position sale and exact fee receipt", t => {
  const h = harness(t); const tx = name => JSON.parse(readFileSync(new URL("../research/bwa-live-20261001/" + name + ".json", import.meta.url))).response.result;
  const explain = name => { const value = tx(name); return h.api.explainWalletTransaction(value, value.transaction.signatures[0]); };
  assert.equal(explain("create").action, "Launched + bought");
  assert.equal(explain("sell-one").action, "Sold part of position");
  assert.equal(explain("sell-two").action, "Fully sold position");
  const fee = explain("aggregate-fee-collection"); assert.equal(fee.action, "Collected creator fees"); assert.equal(fee.creatorReceiptLamports, "29950879"); assert.notEqual(fee.creatorReceiptLamports, fee.nativeChangeLamports);
  const changed = tx("aggregate-fee-collection"); changed.transaction.message.instructions = []; changed.meta.innerInstructions = [];
  assert.equal(h.api.explainWalletTransaction(changed, "transfer").action, "Other wallet activity");
});
test("failed transactions are retained without claiming successful action or known earnings", async t => {
  const h = harness(t); h.state.page = [{ signature: "failed", blockTime: 100, err: { InstructionError: [] } }];
  const result = await h.api.refreshWalletLive("owner"); assert.equal(result.items[0].status, "failed"); assert.equal(result.items[0].action, "Failed transaction"); assert.equal(result.pending, 0);
  assert.equal(h.state.calls.filter(x => x.method === "getTransaction").length, 0);
});

test("an older provider head cannot send discovery backwards past the saved slot", async t => {
  const h = harness(t); h.state.page = [{ signature: "base", blockTime: 100, slot: 200, err: null }]; await h.api.refreshWalletLive("owner"); h.next();
  h.state.page = [{ signature: "old", blockTime: 99, slot: 199, err: null }]; const result = await h.api.refreshWalletLive("owner");
  assert.equal(result.status, "error"); assert.equal(h.cursor().anchor, "base"); assert.equal(h.count(), 1);
  assert.equal(h.state.calls.filter(c => c.method === "getSignaturesForAddress").at(-1).args[1].minContextSlot, 200);
});
test("unknown-time new activity stays visible above a full older feed", async t => {
  const h = harness(t);
  for (let i = 0; i < 65; i++) h.db.prepare("INSERT INTO settings VALUES('owner',?,?)").run("bwa_live_tx_old" + i, JSON.stringify({ signature: "old" + i, blockTime: 100, status: "confirmed", seenAt: "2020-01-01T00:00:00Z" }));
  h.state.page = [{ signature: "new-unknown-time", blockTime: null, slot: 300, err: null }]; h.state.tx = () => null;
  const result = await h.api.refreshWalletLive("owner"); assert.equal(result.items[0].signature, "new-unknown-time"); assert.equal(result.items[0].occurredAt, null);
});
test("hydration stops at the tick budget and keeps remaining entries pending", async t => {
  const h = harness(t); h.state.page = signatures("one", "two", "three");
  h.state.tx = () => { h.next(); return null; };
  const result = await h.api.refreshWalletLive("owner"); assert.equal(result.pending, 3); assert.equal(h.state.calls.filter(c => c.method === "getTransaction").length, 1);
});
