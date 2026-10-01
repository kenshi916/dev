import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

const filename = new URL("../app/server/wallet-analysis.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const evaluated = { exports: {} };
vm.runInNewContext(compiled, { module: evaluated, exports: evaluated.exports,
  require(name) { if (name === "bs58") return bs58; throw new Error("Unexpected dependency " + name); },
}, { filename: filename.pathname });
const { analyzeWalletTransaction: analyze, analyzeWalletSample: scan, PUMP_PROGRAM, PUMP_SWAP_PROGRAM, WSOL_MINT, formatRaw } = evaluated.exports;
const WALLET = "wallet", MINT = "base-mint", BASE = "base-account", RENT = 2_039_280;
const token = (index, mint, raw, decimals = 6, owner = WALLET) => ({ accountIndex: index, mint, owner, uiTokenAmount: { amount: String(raw), decimals, uiAmount: null } });
const ix = (side = "buy", amm = false) => {
  const accounts = Array(16).fill("other");
  accounts[amm ? 1 : 6] = WALLET;
  accounts[amm ? 3 : 2] = MINT;
  accounts[5] = BASE;
  if (amm) accounts[4] = WSOL_MINT;
  return { programId: amm ? PUMP_SWAP_PROGRAM : PUMP_PROGRAM, accounts,
    data: bs58.encode(Uint8Array.from([...(side === "buy" ? [102, 6, 61, 18, 1, 218, 235, 234] : [51, 230, 133, 164, 1, 127, 131, 173]), ...Array(16).fill(0)])) };
};
function transaction({ side = "buy", before = "0", after = "1000000", flow = -1_000_000_000, time = 100, amm = false } = {}) {
  return { blockTime: time,
    transaction: { message: { accountKeys: [{ pubkey: WALLET, signer: true }, { pubkey: BASE, signer: false }, { pubkey: "pool", signer: false }], instructions: [ix(side, amm)] } },
    meta: { err: null, fee: 5000, preBalances: [10_000_000_000, RENT, 10_000_000_000], postBalances: [10_000_000_000 + flow - 5000, RENT, 10_000_000_000 - flow],
      preTokenBalances: [token(1, MINT, before)], postTokenBalances: [token(1, MINT, after)], innerInstructions: [] },
  };
}
const sell = (options = {}) => transaction({ side: "sell", before: "1000000", after: "0", flow: 2_000_000_000, time: 160, ...options });
const sample = (transaction, signature) => ({ signature, transaction });
const transfer = () => {
  const tx = transaction(); tx.transaction.message.instructions = [{ programId: "11111111111111111111111111111111", parsed: { type: "transfer", info: { source: WALLET, destination: "other" } } }]; return tx;
};

test("recognized direct Pump swap uses exact token deltas and adds back only its network fee", () => {
  const result = analyze(transaction(), WALLET, "buy");
  assert.equal(result.trade.side, "buy");
  assert.equal(result.trade.tokenAmountRaw, "1000000");
  assert.equal(result.native.changeLamports, "-1000005000");
  assert.equal(result.trade.quoteFlowLamports, "-1000000000");
  assert.equal(result.trade.networkFeePaidLamports, "5000");
  assert.match(result.summary, /-1 SOL/);
  assert.equal(result.sourceUrl, "https://solscan.io/tx/buy");
});
test("matched entry and exit report bounded cashflow after both fees and elapsed seconds", () => {
  const result = scan([sample(sell(), "sell"), sample(transaction(), "buy")], WALLET);
  assert.equal(result.roundTrips.length, 1);
  assert.equal(result.roundTrips[0].netSolCashflowLamports, "999990000");
  assert.equal(result.roundTrips[0].networkFeesLamports, "10000");
  assert.equal(result.roundTrips[0].holdingSeconds, 60);
  assert.equal(result.roundTrips[0].sources.map((s) => s.signature).join(","), "buy,sell");
  assert.match(result.observations[0].summary, /0.99999 SOL net cashflow/);
  assert.match(result.roundTrips[0].note, /Activity that omits the wallet address may be absent/);
});
test("negative cashflow remains a loss and missing timestamps never invent holding time", () => {
  const result = scan([sample(sell({ flow: 800_000_000, time: null }), "sell"), sample(transaction(), "buy")], WALLET);
  assert.equal(result.roundTrips[0].netSolCashflowLamports, "-200010000");
  assert.equal(result.roundTrips[0].holdingSeconds, null);
});
test("fees paid by another signer are not charged to tracked wallet cashflow", () => {
  const tx = transaction();
  tx.transaction.message.accountKeys.unshift({ pubkey: "payer", signer: true });
  tx.meta.preBalances.unshift(1_000_000); tx.meta.postBalances.unshift(995_000);
  tx.meta.postBalances[1] += 5000;
  tx.meta.preTokenBalances[0].accountIndex = tx.meta.postTokenBalances[0].accountIndex = 2;
  const result = analyze(tx, WALLET, "other-payer");
  assert.equal(result.native.feePaidByWalletLamports, "0");
  assert.equal(result.trade.quoteFlowLamports, "-1000000000");
});
test("new token account rent and closed account refunds do not become trade cashflow", () => {
  const buy = transaction(); buy.meta.preBalances[1] = 0; buy.meta.postBalances[0] -= RENT; buy.meta.preTokenBalances = [];
  const exit = sell(); exit.meta.postBalances[1] = 0; exit.meta.postBalances[0] += RENT; exit.meta.postTokenBalances = [];
  assert.equal(analyze(buy, WALLET, "buy").trade.quoteFlowLamports, "-1000000000");
  assert.equal(analyze(exit, WALLET, "sell").trade.quoteFlowLamports, "2000000000");
  assert.equal(scan([sample(exit, "sell"), sample(buy, "buy")], WALLET).roundTrips[0].netSolCashflowLamports, "999990000");
});
test("PumpSwap spending preexisting WSOL counts native backing once", () => {
  const tx = transaction({ amm: true, flow: 0 });
  tx.transaction.message.accountKeys.push({ pubkey: "wrapped-account", signer: false });
  tx.meta.preBalances.push(2_000_000_000 + RENT); tx.meta.postBalances.push(1_000_000_000 + RENT);
  tx.meta.preTokenBalances.push(token(3, WSOL_MINT, "2000000000", 9)); tx.meta.postTokenBalances.push(token(3, WSOL_MINT, "1000000000", 9));
  const result = analyze(tx, WALLET, "wsol");
  assert.equal(result.trade.protocol, "PumpSwap");
  assert.equal(result.wrappedSolChangeRaw, "-1000000000");
  assert.equal(result.trade.quoteFlowLamports, "-1000000000");
});
test("plain token/SOL transfers do not become trades", () => {
  const result = analyze(transfer(), WALLET, "transfer");
  assert.equal(result.trade, null);
  assert.equal(result.kind, "balance_change");
  assert.match(result.summary, /Transfers are not automatically trades/);
});
test("a swap plus unrelated transfer has no attributable quote cashflow", () => {
  const tx = transaction(); tx.transaction.message.instructions.push(transfer().transaction.message.instructions[0]);
  const result = analyze(tx, WALLET, "mixed");
  assert.equal(result.trade.side, "buy"); assert.equal(result.trade.quoteFlowLamports, null);
  assert.match(result.trade.excludedReasons.join(" "), /Other transaction instructions/);
});
test("nested swaps and multiple swaps are never assigned transaction-wide returns", () => {
  const nested = transaction(); nested.meta.innerInstructions = [{ index: 0, instructions: nested.transaction.message.instructions }]; nested.transaction.message.instructions = [{ programId: "aggregator" }];
  assert.equal(analyze(nested, WALLET, "cpi").trade.quoteFlowLamports, null);
  const multi = transaction(); multi.transaction.message.instructions.push(ix("buy"));
  assert.equal(analyze(multi, WALLET, "multi").trade, null);
});
test("unsupported quote tokens and unresolved account creation prevent SOL attribution", () => {
  const nonSol = transaction({ amm: true }); nonSol.transaction.message.instructions[0].accounts[4] = "usdc-mint";
  assert.equal(analyze(nonSol, WALLET, "usdc").trade.quoteFlowLamports, null);
  const created = transaction(); created.meta.preBalances[2] = 0;
  assert.equal(analyze(created, WALLET, "rent").trade.quoteFlowLamports, null);
});
test("missing owners, unknown native balances, malformed token metadata fail closed", () => {
  const owner = transaction(); delete owner.meta.preTokenBalances[0].owner;
  assert.equal(analyze(owner, WALLET, "owner").tokenBalanceCoverageComplete, false);
  assert.equal(analyze(owner, WALLET, "owner").trade, null);
  const unsafe = transaction(); unsafe.meta.preBalances[0] = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(analyze(unsafe, WALLET, "unsafe").trade.quoteFlowLamports, null);
  const absent = transaction(); absent.meta.preTokenBalances = [];
  assert.equal(analyze(absent, WALLET, "absent").tokenBalanceCoverageComplete, false);
  assert.equal(analyze(absent, WALLET, "absent").trade, null);
});
test("preexisting inventory and open partial exits have no matched return", () => {
  const preexisting = transaction({ before: "1000000", after: "2000000" });
  assert.equal(scan([sample(sell({ before: "2000000" }), "sell"), sample(preexisting, "buy")], WALLET).roundTrips.length, 0);
  assert.equal(scan([sample(sell({ after: "500000" }), "partial"), sample(transaction(), "buy")], WALLET).roundTrips.length, 0);
  assert.equal(scan([sample(sell(), "outside-window")], WALLET).roundTrips.length, 0);
});
test("transfers, missing transactions and balance discontinuities break matching", () => {
  assert.equal(scan([sample(sell(), "sell"), sample(transfer(), "transfer"), sample(transaction(), "buy")], WALLET).roundTrips.length, 0);
  assert.equal(scan([sample(sell(), "sell"), sample(null, "unavailable"), sample(transaction(), "buy")], WALLET).roundTrips.length, 0);
  assert.equal(scan([sample(sell({ before: "2000000" }), "sell"), sample(transaction(), "buy")], WALLET).roundTrips.length, 0);
});
test("failed transactions are absent and unknown token ownership breaks open matches", () => {
  const failed = transaction(); failed.meta.err = { InstructionError: [0, "Custom"] };
  assert.equal(analyze(failed, WALLET, "failed"), null);
  const unknown = transfer(); delete unknown.meta.preTokenBalances[0].owner; delete unknown.meta.postTokenBalances[0].owner;
  assert.equal(scan([sample(sell(), "sell"), sample(unknown, "unknown"), sample(transaction(), "buy")], WALLET).roundTrips.length, 0);
});
test("large raw amounts are preserved without floating point rounding", () => {
  const raw = "9007199254740993123456789";
  const result = analyze(transaction({ after: raw }), WALLET, "large");
  assert.equal(result.trade.tokenAmountRaw, raw);
  assert.equal(formatRaw(raw, 6), "9007199254740993123.456789");
  assert.equal(formatRaw("-10000", 9), "-0.00001");
});

function scannerHarness(t, transactions) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE tracks(id TEXT, owner TEXT, kind TEXT, query TEXT, last_checked TEXT); CREATE TABLE signals(id TEXT,owner TEXT,kind TEXT,source TEXT,text TEXT,created_at TEXT,url TEXT,likes INTEGER,PRIMARY KEY(id,owner));");
  db.prepare("INSERT INTO tracks VALUES('track','owner','wallet',?,NULL)").run(WALLET);
  const calls = [], events = [];
  class AppError extends Error {}
  const core = {
    AppError, now: () => new Date().toISOString(),
    rows: async (sql, ...args) => db.prepare(sql).all(...args),
    one: async (sql, ...args) => db.prepare(sql).get(...args),
    change: async (sql, ...args) => ({ meta: { changes: db.prepare(sql).run(...args).changes } }),
    event: async (...args) => { events.push(args); },
    external: async () => ({ json: async () => ({ description: "Public launch metadata" }) }),
    rpc: async (owner, method, args) => {
      assert.equal(owner, "owner"); calls.push({ method, args });
      if (method === "getSignaturesForAddress") return Object.keys(transactions).map((signature) => ({ signature, err: null }));
      if (method === "getTransaction") { const value = transactions[args[0]]; if (value instanceof Error) throw value; return value; }
      throw new Error("Unexpected method " + method);
    },
  };
  const source = ts.transpileModule(readFileSync(new URL("../app/server/signals.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const dependencies = { "./core": core, "@solana/web3.js": { PublicKey }, bs58, "./wallet-analysis": evaluated.exports, "./twitter-provider": {} };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, Buffer,
    require(name) { if (name in dependencies) return dependencies[name]; throw new Error("Unexpected dependency " + name); },
  });
  return { db, calls, events, refresh: () => mod.exports.refreshWallets("owner") };
}
test("scanner persists source-linked analysis, preserves launches and legacy IDs, and respects cooldown", async (t) => {
  const created = transaction({ flow: 0 });
  const string = (value) => { const bytes = Buffer.from(value); const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length, bytes]); };
  const accounts = Array(8).fill("other"); accounts[0] = PUMP_PROGRAM; accounts[7] = WALLET;
  created.transaction.message.instructions = [{ programId: PUMP_PROGRAM, accounts,
    data: bs58.encode(Buffer.concat([Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]), string("Test Launch"), string("TEST"), string("https://example.com/token.json"), new PublicKey(PUMP_PROGRAM).toBuffer()])) }];
  const h = scannerHarness(t, { exit: sell(), entry: transaction(), launch: created });
  h.db.prepare("INSERT INTO signals VALUES('entry','owner','wallet',?,'old','2020-01-01','old',0)").run(WALLET);
  const result = await h.refresh();
  assert.equal(result.launches, 1); assert.equal(result.trades, 2); assert.equal(result.matchedRoundTrips, 1);
  const rows = h.db.prepare("SELECT * FROM signals ORDER BY id").all();
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.id === "entry").length, 1);
  for (const row of rows) { assert.match(row.text, /^\{"summary":/); assert.match(row.url, /^https:\/\/solscan.io\/tx\//); }
  const launch = rows.map((r) => JSON.parse(r.text)).find((r) => r.observation === "launch");
  assert.equal(launch.name, "Test Launch"); assert.equal(launch.description, "Public launch metadata");
  const exit = rows.map((r) => JSON.parse(r.text)).find((r) => r.analysis.signature === "exit");
  assert.equal(exit.analysis.matchedRoundTrips[0].netSolCashflowLamports, "999990000");
  assert.match(exit.summary, /0.99999 SOL net cashflow/);
  const calls = h.calls.length; await h.refresh(); assert.equal(h.calls.length, calls);
  h.db.prepare("UPDATE tracks SET last_checked=NULL").run(); await h.refresh();
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM signals").get().n, 3);
});
test("scanner surfaces RPC access failure rather than reporting no activity", async (t) => {
  const h = scannerHarness(t, { unavailable: new Error("RPC access unavailable") });
  await assert.rejects(h.refresh, /RPC access unavailable/);
  assert.equal(h.events.length, 0);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM signals").get().n, 0);
});
