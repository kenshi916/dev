import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const filename = new URL(path, import.meta.url), compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error("Unexpected dependency " + name);
  } }, { filename: filename.pathname });
  return module.exports;
}
const { deployStudyEvidence: study } = load("../app/server/deploy-study-evidence.ts");
const WALLET = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
function row(signature, { mint = "coin", launch = false, blockTime = 100, wallet = WALLET, trade = null, matches = [] } = {}) {
  return { text: JSON.stringify({ wallet, observation: launch ? "launch" : "pump_trade", name: "Actual coin", symbol: "ACT", mint,
    launchingUser: launch ? wallet : undefined, declaredCreator: WALLET, image: "https://ipfs.io/ipfs/coinart", blockTime,
    analysis: { version: 1, wallet, signature, blockTime, tokenBalanceCoverageComplete: true, trade, matchedRoundTrips: matches,
      native: { changeLamports: launch ? "-10000000" : "0" } } }), created_at: "2026-10-01T00:00:00.000Z", url: "https://untrusted.example/never-use" };
}
function pair({ profit = "999990000", holding = true, account = "account", mint = "coin", prefix = "", flow = "2000000000" } = {}) {
  const buySig = prefix + "buy", sellSig = prefix + "sell";
  const match = { scope: "sampled_token_account_round_trip", mint, tokenAccount: account,
    netSolCashflowLamports: profit, networkFeesLamports: "10000", buys: 1, sells: 1, holdingSeconds: 60,
    sources: [{ signature: buySig, url: "https://untrusted.example" }, { signature: sellSig, url: "https://untrusted.example" }] };
  const base = { mint, tokenAccount: account, attribution: "isolated_swap_sol_cashflow", networkFeePaidLamports: "5000" };
  return { buy: row(buySig, { mint, blockTime: holding ? 100 : null, trade: { ...base, side: "buy", tokenAccountBeforeRaw: "0", tokenAccountAfterRaw: "100", quoteFlowLamports: "-1000000000" } }),
    sell: row(sellSig, { mint, blockTime: holding ? 160 : null, trade: { ...base, side: "sell", tokenAccountBeforeRaw: "100", tokenAccountAfterRaw: "0", quoteFlowLamports: flow }, matches: [match] }), match };
}
function edit(item, change) { const copy = JSON.parse(item.text); change(copy); return { ...item, text: JSON.stringify(copy) }; }

test("study shows actual launched mint and bounded cashflow without inventing creator revenue", () => {
  const p = pair(), result = study([p.sell, p.buy, row("create", { launch: true, blockTime: 50 })], WALLET);
  assert.equal(result.deployments.length, 1);
  assert.equal(result.deployments[0].name, "Actual coin");
  assert.equal(result.deployments[0].transaction, "https://solscan.io/tx/create");
  assert.equal(result.deployments[0].earnings.matchedNetSolLamports, "999990000");
  assert.equal(result.deployments[0].earnings.creatorFeesSolLamports, null);
  assert.equal(result.deployments[0].earnings.holdingSecondsMedian, 60);
  assert.equal(result.deployments[0].launchWalletChangeLamports, "-10000000");
  assert.equal(result.summary.lifetimePnlSolLamports, null);
  assert.equal(result.summary.creatorFeesSolLamports, null);
  assert.equal(result.summary.deployedCoinMatchedNetSolLamports, "999990000");
  assert.equal(result.summary.profitableRoundTrips, 1);
  assert.match(result.summary.earningsScope, /Not creator-fee revenue, dev profit/);
});

test("zero evidence and unmatched sells report unknown, not zero earnings", () => {
  const empty = study([], WALLET), p = pair();
  assert.equal(empty.summary.matchedNetSolLamports, null);
  assert.equal(empty.summary.observedTransactionCount, 0);
  const missing = study([p.sell, row("create", { launch: true })], WALLET);
  assert.equal(missing.deployments[0].earnings.matchedNetSolLamports, null);
  assert.equal(missing.deployments[0].sampleSellCount, 1);
  assert.match(missing.deployments[0].observations.at(-1), /No complete entry-to-exit/);
});

test("study includes losses and separates trades on unrelated coins from own deploys", () => {
  const loss = pair({ profit: "-200010000", flow: "800000000" });
  const other = pair({ prefix: "other-", account: "other-account", mint: "other-coin" });
  const result = study([loss.sell, loss.buy, other.sell, other.buy, row("create", { launch: true })], WALLET);
  assert.equal(result.summary.matchedNetSolLamports, "799980000");
  assert.equal(result.summary.deployedCoinMatchedNetSolLamports, "-200010000");
  assert.equal(result.summary.losingRoundTrips, 1);
  assert.equal(result.summary.profitableRoundTrips, 0);
});

test("duplicate observations and overlapping match receipts cannot double-count earnings", () => {
  const p = pair();
  const duplicate = edit(row("another"), (data) => { data.analysis.matchedRoundTrips = [p.match]; });
  const result = study([p.sell, p.sell, duplicate, p.buy], WALLET);
  assert.equal(result.summary.matchedRoundTrips, 1);
  assert.equal(result.summary.matchedNetSolLamports, "999990000");
});

test("mismatched balances, unrelated transfers and forged totals never become returns", () => {
  const p = pair();
  for (const corrupt of [
    data => { data.analysis.trade.tokenAccountBeforeRaw = "99"; },
    data => { data.analysis.trade.attribution = "unattributed"; },
    data => { data.analysis.trade.mint = "other"; },
    data => { data.analysis.matchedRoundTrips[0].netSolCashflowLamports = "999999999999"; },
    data => { data.analysis.matchedRoundTrips[0].networkFeesLamports = "0"; },
    data => { data.analysis.tokenBalanceCoverageComplete = false; },
    data => { data.analysis.wallet = "other-wallet"; },
  ]) {
    assert.equal(study([edit(p.sell, corrupt), p.buy], WALLET).summary.matchedNetSolLamports, null);
  }
});

test("missing timestamps remain unknown and malformed/nonmatching rows are ignored", () => {
  const p = pair({ holding: false });
  const result = study([p.sell, p.buy, row("create", { launch: true, blockTime: null }), row("other", { wallet: "other-wallet", launch: true }), { text: "invalid" }], WALLET);
  assert.equal(result.deployments[0].deployedAt, null);
  assert.equal(result.deployments[0].earnings.holdingSecondsMedian, null);
  assert.equal(result.coverage.oldestObservedAt, null);
  assert.equal(result.coverage.missingTimestampCount, 3);
  assert.equal(result.summary.deploymentCount, 1);
});

test("all observed launches counted while displayed list is bounded and cadence is explicitly partial", () => {
  const result = study(Array.from({ length: 35 }, (_, n) => row("create-" + n, { launch: true, mint: "mint-" + n, blockTime: n * 30 })), WALLET);
  assert.equal(result.summary.deploymentCount, 35);
  assert.equal(result.deployments.length, 32);
  assert.equal(result.deployments[0].mint, "mint-34");
  assert.match(result.lessons[1].evidence, /30 seconds/);
  assert.match(result.lessons[1].limitation, /does not measure response time to a tweet/);
  assert.equal(result.coverage.partial, true);
});

test("study refresh distinguishes RPC failure from absent history and uses bounded deep mode", async () => {
  const calls = [], saved = [], settings = [];
  let fail = false;
  const api = load("../app/server/deploy-study.ts", {
    "./core": { change: async () => {}, rows: async (...args) => { calls.push(args); return saved; }, now: () => "2026-10-01T00:00:00.000Z", setSetting: async (...args) => settings.push(args) },
    "./signals": { TRACKED_WALLET: WALLET, refreshWallets: async (...args) => { calls.push(args); if (fail) throw new Error("secret RPC URL should not leak"); return { examined: 10 }; } },
    "./deploy-study-evidence": { deployStudyEvidence: study },
    "../bwa-reference": { BWA_REFERENCE_CASE: { checkedAt: "2026-10-01T12:47:48.015Z", scope: "Dated reference case, not fresh evidence" } },
  });
  const result = await api.studyDeploys("owner", true, true);
  assert.equal(calls[0][2].limit, 80);
  assert.equal(result.refreshStatus, "On-chain sample refreshed");
  assert.equal(result.refreshError, null);
  assert.equal(settings[0][1], "deploy_study");
  fail = true;
  const failed = await api.studyDeploys("owner");
  assert.match(failed.refreshStatus, /unavailable/);
  assert.equal(failed.summary.matchedNetSolLamports, null);
  assert.equal(JSON.stringify(failed).includes("secret RPC URL"), false);
  assert.equal(calls[2][2].limit, 12);
});
