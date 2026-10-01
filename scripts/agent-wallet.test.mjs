import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as solana from "@solana/web3.js";
import bs58 from "bs58";

const root = new URL("../", import.meta.url);
function load(path, dependencies) {
  const source = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error("Unexpected module: " + name);
    }, Request, Response, Headers, TextEncoder, TextDecoder, URL, ReadableStream,
    AbortSignal, crypto: globalThis.crypto, Uint8Array, Buffer, btoa, atob,
    fetch: () => { throw new Error("Live network calls forbidden in tests"); },
  });
  return module.exports;
}

function harness(t) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("drizzle/0000_broad_apocalypse.sql", root), "utf8"));
  t.after(() => sql.close());
  const database = {
    prepare(query) {
      const statement = sql.prepare(query);
      const bind = (...args) => ({
        bind: (...values) => bind(...values),
        exec() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
        async run() { return this.exec(); },
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
      });
      return bind();
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try { const result = statements.map(s => s.exec()); sql.exec("COMMIT"); return result; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  };
  const core = load("app/server/core.ts", {
    "cloudflare:workers": { env: { DB: database, CREDENTIAL_SECRET: "fixture-key-for-isolated-memory-tests" } },
    "../chatgpt-auth": { getChatGPTUser: async () => ({ userId: "owner-a" }) },
  });
  let balance = 50_000_000, rpcFails = false, ai = true;
  core.rpc = async (_owner, method) => {
    assert.equal(method, "getBalance");
    if (rpcFails) throw new Error("unavailable");
    return { value: balance };
  };
  const avatars = load("app/agent-avatars.ts", {});
  const accounting = load("app/server/coin-accounting.ts", { "@solana/web3.js": solana, bs58: { default: bs58 } });
  const wallet = load("app/server/agent-wallet.ts", { "../agent-avatars": avatars, "@solana/web3.js": solana, "./core": core,
    "./ai-access": { aiAccessStatus: async () => ({ available: ai }) } });
  const evidence = load("app/server/agent-evidence.ts", { "./core": core });
  const input = { creationId: crypto.randomUUID(), name: "Fixture agent", model: "fixture/model",
    mission: "Skip weak ideas and explain observed themes.", recipient: solana.Keypair.generate().publicKey.toBase58(),
    maxSol: "0.05", perLaunch: "0.015", maxLaunches: "3" };
  const ready = async () => {
    for (const provider of ["rpc", "pinata"]) await core.setSecret("owner-a", provider, "fixture-token");
    await core.setSetting("owner-a", "session_image", "https://example.test/fixture.png");
  };
  const signal = (id, age = 1000, url = "https://x.com/fixture/status/" + id, owner = "owner-a") =>
    sql.prepare("INSERT INTO signals(id,owner,kind,source,text,url,created_at) VALUES (?,?,'tweet','fixture','Public source',?,?)")
      .run(id, owner, url, new Date(Date.now() - age).toISOString());
  const runRoute = (respond, launched = () => {}) => {
    core.external = async () => Response.json(await respond());
    return load("app/api/run/route.ts", {
      "../../server/core": core,
      "../../server/ai-access": { openRouterAccess: async () => ({ apiKey: "fixture-token" }) },
      "../../server/agent-evidence": evidence,
      "../../server/agent-wallet": wallet,
      "../../server/launch": { autoLaunch: async () => launched() },
      "../../server/deploy-study": { studyDeploys: async () => ({ deployments: [], refreshStatus: "Fixture observations" }) },
    });
  };
  return { sql, core, wallet, evidence, avatars, accounting, input, ready, signal, runRoute, setBalance: value => { balance = value; }, failRpc: () => { rpcFails = true; }, disableAi: () => { ai = false; } };
}

test("wallet can be created before return address and configured only before activation", async t => {
  const h = harness(t);
  const { recipient, maxSol, perLaunch, maxLaunches, ...minimal } = h.input;
  await h.wallet.createAgentWallet("owner-a", minimal); await h.ready();
  const row = h.sql.prepare("SELECT * FROM sessions").get();
  assert.equal(row.recipient, ""); assert.equal(row.enabled, 0);
  await assert.rejects(h.wallet.toggleAgentWallet("owner-a", minimal.creationId, true), /return address/);
  await h.wallet.configureAgentWallet("owner-a", minimal.creationId, h.input);
  await h.wallet.toggleAgentWallet("owner-a", minimal.creationId, true);
  await h.wallet.toggleAgentWallet("owner-a", minimal.creationId, false);
  await assert.rejects(h.wallet.configureAgentWallet("owner-a", minimal.creationId, h.input), /fixed/);
});

test("a newer pause supersedes activation waiting for RPC", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input); await h.ready();
  let release, entered;
  const enteredRpc = new Promise(resolve => { entered = resolve; });
  h.core.rpc = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const activation = h.wallet.toggleAgentWallet("owner-a", h.input.creationId, true);
  await enteredRpc;
  await h.wallet.toggleAgentWallet("owner-a", h.input.creationId, false);
  release({ value: 50_000_000 });
  await assert.rejects(activation, /superseded/);
  assert.equal(h.sql.prepare("SELECT enabled FROM sessions").get().enabled, 0);
});

test("retirement without a return address leaves setup configurable", async t => {
  const h = harness(t);
  await h.wallet.createAgentWallet("owner-a", { ...h.input, recipient: "" });
  const launch = load("app/server/launch.ts", { "@solana/web3.js": solana, "@pump-fun/pump-sdk": {}, "./limits": {}, "./core": h.core, "./coin-accounting": h.accounting });
  await assert.rejects(launch.withdrawSession("owner-a", h.input.creationId), /return address/);
  assert.equal(h.sql.prepare("SELECT expires_at FROM sessions").get().expires_at, h.wallet.SETUP_EXPIRY);
  await h.wallet.configureAgentWallet("owner-a", h.input.creationId, h.input);
});

test("concurrent agents cannot claim the same normalized coin name or ticker", async t => {
  const h = harness(t), second = { ...h.input, creationId: crypto.randomUUID(), name: "Second" };
  await h.wallet.createAgentWallet("owner-a", h.input); await h.wallet.createAgentWallet("owner-a", second);
  h.sql.exec("UPDATE agents SET status='running'"); h.signal("source");
  const signals = await h.evidence.freshAgentSignals("owner-a", h.input.creationId);
  const proposal = { name: "A Fresh Theme", symbol: "FRESH", description: "Description", summary: "Summary", sourceIds: ["source"] };
  const results = await Promise.allSettled([h.evidence.saveEvidenceProposal("owner-a", h.input.creationId, proposal, signals), h.evidence.saveEvidenceProposal("owner-a", second.creationId, { ...proposal, name: "a fresh-theme" }, signals)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM drafts").get().n, 1);
});

test("only reference deployments with known fresh transaction times qualify as launch evidence", async t => {
  const h = harness(t), wallet = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
  for (const [id, blockTime, launchingUser] of [["fresh", Date.now() / 1000 - 60, wallet], ["unknown", null, wallet], ["old", Date.now() / 1000 - 86400, wallet], ["foreign", Date.now() / 1000 - 60, "another-wallet"]]) {
    h.sql.prepare("INSERT INTO signals(id,owner,kind,source,text,url,created_at) VALUES (?,'owner-a','wallet',?,?,?,?)")
      .run(id, wallet, JSON.stringify({ observation: "launch", wallet, launchingUser, blockTime }), "https://solscan.io/tx/" + id, new Date().toISOString());
  }
  assert.deepEqual(Array.from(await h.evidence.freshAgentSignals("owner-a", "agent"), s => s.id), ["fresh"]);
});

test("public activity includes only public profiles and verified launches, with no private fields", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input);
  const privateAgent = { ...h.input, creationId: crypto.randomUUID(), name: "Private profile" };
  await h.wallet.createAgentWallet("owner-b", privateAgent);
  h.sql.prepare("DELETE FROM settings WHERE owner='owner-b' AND key=?").run("public_agent_" + privateAgent.creationId);
  for (const status of ["draft", "submitted", "failed", "launched"]) {
    h.sql.prepare("INSERT INTO drafts(id,owner,agent_id,name,symbol,description,rationale,status,mint,signature,created_at) VALUES (?,'owner-a',?,'Coin','COIN','Private description','Private thesis',?,'mint','signature',?)").run(status, h.input.creationId, status, new Date().toISOString());
    await h.core.setSetting("owner-a", "public_launch_" + status, { confirmedAt: new Date().toISOString() });
  }
  const activity = load("app/server/public-activity.ts", { "./core": h.core, "../agent-avatars": h.avatars, "./coin-accounting": h.accounting });
  await h.core.setSetting("owner-a", "launch_thesis_launched", { summary: "I built this from the source theme.", owner: "must-not-leak", sources: [{ kind: "tweet", author: "source", text: "Public tweet", url: "https://x.com/source/status/123", secret: "must-not-leak" }, { kind: "tweet", url: "javascript:alert(1)" }] });
  const items = await activity.publicActivity();
  assert.equal(items.length, 2);
  assert.equal(items.filter(i => i.kind === "coin_launched").length, 1);
  const serialized = JSON.stringify(items);
  for (const forbidden of ["owner-a", "owner-b", "Private profile", "Private thesis", "private_key", "recipient", "must-not-leak", "javascript:", h.input.mission]) assert(!serialized.includes(forbidden));
  const coins = await activity.publicActivity("coin_launched");
  assert.equal(coins.length, 1); assert.equal(coins[0].thesis.sources.length, 1);
  assert.equal(coins[0].thesis.sources[0].url, "https://x.com/source/status/123");
});

test("public launch confirmation bypasses owner-controlled RPC and requires successful execution", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input);
  h.sql.prepare("INSERT INTO drafts(id,owner,agent_id,name,symbol,description,rationale,status,mint,signature,prepared,created_at) VALUES ('coin','owner-a',?,'Coin','COIN','','','submitted','mint','signature',?,?)").run(h.input.creationId, JSON.stringify({ wallet: "payer" }), new Date().toISOString());
  let trustedCalls = 0, tx = null;
  h.core.rpc = async () => { throw new Error("Owner-controlled RPC must not be used"); };
  h.core.publicLaunchTransaction = async () => { trustedCalls++; return tx; };
  const launch = load("app/server/launch.ts", { "@solana/web3.js": solana, "@pump-fun/pump-sdk": {}, "./limits": {}, "./core": h.core, "./coin-accounting": h.accounting });
  assert.equal((await launch.confirmLaunch("owner-a", "coin")).status, "submitted");
  tx = { meta: { logMessages: ["Program log: Instruction: CreateV2"] }, transaction: { message: { instructions: [{ programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", accounts: ["mint"] }], accountKeys: [{ pubkey: "payer", signer: true }] } } };
  await assert.rejects(launch.confirmLaunch("owner-a", "coin"), /execution/);
  assert.equal(await h.core.setting("owner-a", "public_launch_coin"), null);
  tx.meta.err = null;
  assert.equal((await launch.confirmLaunch("owner-a", "coin")).status, "launched");
  assert.equal(trustedCalls, 4);
  assert(await h.core.setting("owner-a", "public_launch_coin"));
});

test("public launch costs backfill from the exact signed transaction and survive later missing RPC data", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input);
  const payer = solana.Keypair.generate(), mint = solana.Keypair.generate().publicKey;
  const programId = new solana.PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  // This offline fixture is never submitted; both RPC encodings describe its same signed message.
  const transaction = new solana.VersionedTransaction(new solana.TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: solana.Keypair.generate().publicKey.toBase58(),
    instructions: [new solana.TransactionInstruction({ programId,
      keys: [{ pubkey: mint, isSigner: false, isWritable: true }], data: Buffer.from([1]) })],
  }).compileToV0Message());
  const preparedTransaction = Buffer.from(transaction.serialize()).toString("base64");
  transaction.sign([payer]);
  const signature = bs58.encode(transaction.signatures[0]);
  h.sql.prepare("INSERT INTO drafts(id,owner,agent_id,name,symbol,description,rationale,status,mint,signature,prepared,created_at) VALUES ('cost-coin','owner-a',?,'Cost Coin','COST','','','submitted',?,?,?,?)")
    .run(h.input.creationId, mint.toBase58(), signature, JSON.stringify({
      wallet: payer.publicKey.toBase58(), transaction: preparedTransaction,
    }), new Date().toISOString());
  const parsed = {
    blockTime: 1_700_000_000,
    meta: { err: null, logMessages: ["Program log: Instruction: CreateV2"] },
    transaction: { message: {
      instructions: [{ programId: programId.toBase58(), accounts: [mint.toBase58()] }],
      accountKeys: [{ pubkey: payer.publicKey.toBase58(), signer: true }],
    } },
  };
  const actualDebit = 12_345_678;
  const raw = {
    transaction: [Buffer.from(transaction.serialize()).toString("base64"), "base64"],
    meta: { err: null, preBalances: [100_000_000], postBalances: [100_000_000 - actualDebit] },
  };
  let rawAvailable = false;
  h.core.rpc = async () => { throw new Error("Owner-controlled RPC must not be used"); };
  h.core.publicLaunchTransaction = async (requestedSignature, encoding = "jsonParsed") => {
    assert.equal(requestedSignature, signature);
    return encoding === "base64" ? (rawAvailable ? raw : null) : parsed;
  };
  const launch = load("app/server/launch.ts", { "@solana/web3.js": solana, "@pump-fun/pump-sdk": {}, "./limits": {}, "./core": h.core, "./coin-accounting": h.accounting });
  const snapshot = () => h.core.setting("owner-a", "public_launch_cost-coin");

  assert.equal((await launch.confirmLaunch("owner-a", "cost-coin")).status, "launched");
  const initial = await snapshot();
  assert.equal(initial.launchDebitLamports, null);
  assert.equal(initial.verification, "server-rpc");

  rawAvailable = true;
  assert.equal((await launch.confirmLaunch("owner-a", "cost-coin")).status, "launched");
  const backfilled = await snapshot();
  assert.equal(backfilled.launchDebitLamports, actualDebit);
  assert.equal(backfilled.signature, signature);
  assert.equal(backfilled.mint, mint.toBase58());
  assert.equal(backfilled.confirmedAt, initial.confirmedAt);

  rawAvailable = false;
  assert.equal((await launch.confirmLaunch("owner-a", "cost-coin")).status, "launched");
  assert.deepEqual(await snapshot(), backfilled);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM events WHERE kind='launch'").get().n, 1);
});

test("concurrent creation creates exactly one encrypted, disabled wallet without artwork", async t => {
  const h = harness(t);
  const [a, b] = await Promise.all([h.wallet.createAgentWallet("owner-a", h.input), h.wallet.createAgentWallet("owner-a", h.input)]);
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM agents").get().n, 1);
  const row = h.sql.prepare("SELECT * FROM sessions").get();
  assert.equal(row.enabled, 0); assert.equal(row.expires_at, h.wallet.SETUP_EXPIRY);
  assert.equal(row.image_url, null); assert.match(row.private_key, /^[^.]+\.[^.]+$/);
  assert.equal(row.recipient, h.input.recipient);
});
test("avatar choice persists atomically and cannot change through creation retries", async t => {
  const h = harness(t);
  const results = await Promise.allSettled([
    h.wallet.createAgentWallet("owner-a", { ...h.input, avatar: "patch" }),
    h.wallet.createAgentWallet("owner-a", { ...h.input, avatar: "glitch" }),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const winner = results.find(r => r.status === "fulfilled").value;
  const stored = await h.core.setting("owner-a", "public_agent_" + h.input.creationId);
  assert.equal(stored.avatar, winner.avatar);
  const retried = await h.wallet.createAgentWallet("owner-a", { ...h.input, avatar: stored.avatar });
  assert.equal(retried.publicKey, winner.publicKey);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sessions").get().n, 1);
  assert.equal(h.avatars.agentAvatarId("https://example.test/image.png"), "byte");
});
test("unknown avatar paths are rejected without creating an agent or wallet", async t => {
  const h = harness(t);
  for (const avatar of ["../../secret", "https://example.test/image.png", "", null])
    await assert.rejects(h.wallet.createAgentWallet("owner-a", { ...h.input, avatar }), /available agent avatars/);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM agents").get().n, 0);
});
test("invalid limits or recipient cannot leave a partial agent", async t => {
  const h = harness(t);
  for (const change of [{ maxSol: 2 }, { perLaunch: 0.5 }, { maxLaunches: 0 }, { recipient: "invalid" }])
    await assert.rejects(h.wallet.createAgentWallet("owner-a", { ...h.input, ...change }));
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM agents").get().n, 0);
});
test("idempotent retries cannot change a wallet or expose another owner's wallet", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input);
  await assert.rejects(h.wallet.createAgentWallet("owner-a", { ...h.input, name: "Another name" }), /another configuration/);
  await assert.rejects(h.wallet.sessionReadiness("owner-b", h.input.creationId), /wallet first/);
  await assert.rejects(h.wallet.createAgentWallet("owner-b", h.input));
});
test("missing artwork, unknown balance and insufficient funding block activation", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input);
  assert.equal((await h.wallet.sessionReadiness("owner-a", h.input.creationId)).canActivate, false);
  await h.ready(); h.setBalance(0);
  await assert.rejects(h.wallet.toggleAgentWallet("owner-a", h.input.creationId, true), /needed/);
  h.failRpc(); const state = await h.wallet.sessionReadiness("owner-a", h.input.creationId);
  assert.equal(state.balanceLamports, null); assert.equal(state.canActivate, false);
  assert.equal(h.sql.prepare("SELECT enabled FROM sessions").get().enabled, 0);
});
test("activation starts the window once; pause and resume never reset usage or expiry", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input); await h.ready();
  await h.wallet.toggleAgentWallet("owner-a", h.input.creationId, true);
  const first = h.sql.prepare("SELECT * FROM sessions").get();
  assert(Date.parse(first.expires_at) > Date.now());
  h.sql.exec("UPDATE sessions SET used_lamports=1000000, used_launches=1");
  await h.wallet.toggleAgentWallet("owner-a", h.input.creationId, false);
  await assert.rejects(h.wallet.requireActiveWallet("owner-a", h.input.creationId), /activate/);
  await h.wallet.toggleAgentWallet("owner-a", h.input.creationId, true);
  const resumed = h.sql.prepare("SELECT * FROM sessions").get();
  assert.equal(resumed.expires_at, first.expires_at); assert.equal(resumed.used_lamports, 1000000); assert.equal(resumed.used_launches, 1);
  h.sql.exec("UPDATE sessions SET expires_at='2001-01-01T00:00:00.000Z'");
  await assert.rejects(h.wallet.toggleAgentWallet("owner-a", h.input.creationId, true), /expired/);
});
test("fresh signals exclude stale, future, used, foreign and untrusted URLs", async t => {
  const h = harness(t);
  h.signal("fresh"); h.signal("stale", 7 * 3600000); h.signal("future", -100000);
  h.signal("used"); h.signal("foreign", 1000, undefined, "owner-b"); h.signal("wrong", 1000, "https://example.test/post");
  await h.core.setSetting("owner-a", "agent_sources_agent", ["used"]);
  assert.deepEqual(Array.from(await h.evidence.freshAgentSignals("owner-a", "agent"), s => s.id), ["fresh"]);
});
test("proposal consumes cited evidence atomically and blocks recycled names", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input);
  h.sql.exec("UPDATE agents SET status='running'"); h.signal("source1");
  const signals = await h.evidence.freshAgentSignals("owner-a", h.input.creationId);
  const proposal = { name: "Fresh Theme", symbol: "FRESH", description: "A fixture concept", summary: "Observed source", sourceIds: ["source1"] };
  const saved = await h.evidence.saveEvidenceProposal("owner-a", h.input.creationId, proposal, signals);
  assert(h.sql.prepare("SELECT rationale FROM drafts WHERE id=?").get(saved.id).rationale.includes("https://x.com/fixture/status/source1"));
  assert.equal((await h.evidence.freshAgentSignals("owner-a", h.input.creationId)).length, 0);
  await assert.rejects(h.evidence.saveEvidenceProposal("owner-a", h.input.creationId, proposal, signals), /already used/);
  h.signal("source2"); const next = await h.evidence.freshAgentSignals("owner-a", h.input.creationId);
  await assert.rejects(h.evidence.saveEvidenceProposal("owner-a", h.input.creationId, { ...proposal, sourceIds: ["source2"] }, next), /already exists/);
});
test("failed insert does not consume evidence or announce a saved proposal", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input);
  h.sql.exec("UPDATE agents SET status='running'"); h.signal("source");
  h.sql.exec("CREATE TRIGGER reject_draft BEFORE INSERT ON drafts BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  const signals = await h.evidence.freshAgentSignals("owner-a", h.input.creationId);
  await assert.rejects(h.evidence.saveEvidenceProposal("owner-a", h.input.creationId, { name: "Theme", symbol: "THEME", description: "Description", summary: "Summary", sourceIds: ["source"] }, signals), /fixture failure/);
  assert.equal((await h.evidence.freshAgentSignals("owner-a", h.input.creationId)).length, 1);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM drafts").get().n, 0);
});

const runRequest = agentId => new Request("http://localhost/api/run", {
  method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ agentId }),
});
test("run route rejects disabled wallets and skips empty evidence without calling a model", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input);
  let calls = 0;
  const route = h.runRoute(() => { calls++; throw new Error("No inference expected"); });
  assert.equal((await route.POST(runRequest(h.input.creationId))).status, 409);
  await h.ready(); await h.wallet.toggleAgentWallet("owner-a", h.input.creationId, true);
  const response = await route.POST(runRequest(h.input.creationId));
  assert.equal(response.status, 200);
  const output = await response.text();
  assert.equal(JSON.parse(output.trim()).kind, "skipped"); assert(output.endsWith("\n"));
  assert.equal(calls, 0);
});
test("model may skip a fresh signal without creating a draft or launching", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input); await h.ready();
  await h.wallet.toggleAgentWallet("owner-a", h.input.creationId, true); h.signal("new");
  let launches = 0, calls = 0;
  const route = h.runRoute(() => {
    calls++;
    return { choices: [{ message: { tool_calls: [{ id: "skip", function: { name: "skip_launch", arguments: JSON.stringify({ summary: "Evidence is too weak for a distinct community concept." }) } }] } }] };
  }, () => { launches++; });
  const response = await route.POST(runRequest(h.input.creationId));
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert(events.some(e => e.kind === "skipped")); assert(!events.some(e => e.error));
  assert.equal(calls, 1); assert.equal(launches, 0);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM drafts").get().n, 0);
  assert.equal(h.sql.prepare("SELECT status FROM agents").get().status, "ready");
});

test("an activated run studies deploys, cites a tweet and saves its public launch note before launch", async t => {
  const h = harness(t); await h.wallet.createAgentWallet("owner-a", h.input); await h.ready();
  await h.wallet.toggleAgentWallet("owner-a", h.input.creationId, true); h.signal("fresh-source");
  let calls = 0, launches = 0;
  const call = (name, args = {}) => ({ id: name, function: { name, arguments: JSON.stringify(args) } });
  const route = h.runRoute(() => ({ choices: [{ message: { tool_calls: ++calls === 1
    ? [call("read_deploy_study"), call("read_signals")]
    : [call("save_proposal", { name: "River Study", symbol: "RIVER", description: "A fixture concept grounded in a public source.", summary: "I built River Study from the source's community theme.", sourceIds: ["fresh-source"] })] } }] }), () => { launches++; });
  const response = await route.POST(runRequest(h.input.creationId));
  const output = await response.text();
  assert(!output.includes('"error"')); assert(output.includes('"research"'));
  assert.equal(calls, 2); assert.equal(launches, 1);
  const draft = h.sql.prepare("SELECT * FROM drafts").get();
  const note = await h.core.setting("owner-a", "launch_thesis_" + draft.id);
  assert.equal(note.summary, "I built River Study from the source's community theme.");
  assert.equal(note.sources[0].url, "https://x.com/fixture/status/fresh-source");
  assert.equal(await h.core.setting("owner-a", "public_launch_" + draft.id), null);
});
