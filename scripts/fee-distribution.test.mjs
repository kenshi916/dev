import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const pump = require("@pump-fun/pump-sdk");
const swap = require("@pump-fun/pump-swap-sdk");
const solana = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const bs58 = require("bs58").default;
const BN = require("bn.js");
const { Keypair, PublicKey, VersionedTransaction, SystemProgram } = solana;
const { PUMP_SDK } = pump;
const source = ts.transpileModule(readFileSync(new URL("../app/server/support.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const rent = 890880;
const tokenRent = 2039280;

async function harness(t, options = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE settings(owner TEXT,key TEXT,value TEXT,PRIMARY KEY(owner,key)); CREATE TABLE drafts(id TEXT,owner TEXT,status TEXT,mint TEXT,prepared TEXT,agent_id TEXT); CREATE TABLE sessions(owner TEXT,agent_id TEXT,public_key TEXT);");
  const creator = Keypair.generate();
  const treasury = Keypair.generate();
  const payer = options.treasuryPayer ? treasury : Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const sharing = pump.feeSharingConfigPda(mint);
  const ammAuthority = pump.ammCreatorVaultPda(sharing);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const calls = [];
  const events = [];
  const accounts = new Map();
  const put = (key, owner, data, lamports = rent) => accounts.set(key.toBase58(), {
    owner: owner.toBase58(), executable: false, data: [data.toString("base64"), "base64"], lamports,
  });
  const configData = {
    bump: 255, version: 2, status: { active: {} }, mint, admin: creator.publicKey, adminRevoked: true,
    shareholders: [{ address: creator.publicKey, shareBps: 8000 }, { address: treasury.publicKey, shareBps: 2000 }],
    ...options.config,
  };
  put(sharing, pump.PUMP_FEE_PROGRAM_ID, await PUMP_SDK.offlinePumpFeeProgram.coder.accounts.encode("sharingConfig", configData));
  const curveData = {
    virtualTokenReserves: new BN(1), virtualQuoteReserves: new BN(1), realTokenReserves: new BN(1), realQuoteReserves: new BN(1),
    tokenTotalSupply: new BN(1), complete: Boolean(options.graduated), creator: sharing, isMayhemMode: false,
    isCashbackCoin: false, quoteMint: PublicKey.default, creatorFeeBps: new BN(0), canEditCreatorFee: false, isHolderReward: false,
    ...options.curve,
  };
  put(pump.bondingCurvePda(mint), pump.PUMP_PROGRAM_ID, await PUMP_SDK.offlinePumpProgram.coder.accounts.encode("bondingCurve", curveData));
  put(pump.creatorVaultPda(sharing), SystemProgram.programId, Buffer.alloc(0), rent + (options.curveFees ?? 1000000));
  if (options.graduated) {
    const poolData = {
      poolBump: 255, index: 0, creator: pump.pumpPoolAuthorityPda(mint), baseMint: mint, quoteMint: spl.NATIVE_MINT,
      lpMint: Keypair.generate().publicKey, poolBaseTokenAccount: Keypair.generate().publicKey, poolQuoteTokenAccount: Keypair.generate().publicKey,
      lpSupply: new BN(1), coinCreator: sharing, isMayhemMode: false, isCashbackCoin: false, virtualQuoteReserves: new BN(0),
      creatorFeeBps: new BN(0), canEditCreatorFee: false, isHolderReward: false, ...options.pool,
    };
    put(pump.canonicalPumpPoolPda(mint), pump.PUMP_AMM_PROGRAM_ID, await PUMP_SDK.offlinePumpAmmProgram.coder.accounts.encode("pool", poolData));
    if (!options.noAmmVault) {
      const data = Buffer.alloc(spl.ACCOUNT_SIZE);
      spl.AccountLayout.encode({
        mint: spl.NATIVE_MINT, owner: ammAuthority, amount: BigInt(2000000), delegateOption: 0, delegate: PublicKey.default,
        state: 1, isNativeOption: 1, isNative: BigInt(tokenRent), delegatedAmount: BigInt(0), closeAuthorityOption: 0, closeAuthority: PublicKey.default,
      }, data);
      put(spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, ammAuthority, true), spl.TOKEN_PROGRAM_ID, data, tokenRent + 2000000);
    }
  }
  db.prepare("INSERT INTO drafts VALUES (?,?,?,?,?,?)").run("draft", "owner", "launched", mint.toBase58(), JSON.stringify({ wallet: creator.publicKey.toBase58() }), "agent");
  db.prepare("INSERT INTO settings VALUES (?,?,?)").run("owner", "support", JSON.stringify({ treasury: treasury.publicKey.toBase58(), percentage: 20, mint: "" }));
  const set = (key, value) => db.prepare("INSERT INTO settings VALUES ('owner',?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
  const get = (key) => { const row = db.prepare("SELECT value FROM settings WHERE owner='owner' AND key=?").get(key); return row ? JSON.parse(row.value) : null; };
  let observed = null;
  class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  const core = {
    AppError, id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
    one: async (query, ...args) => db.prepare(query).get(...args),
    change: async (query, ...args) => ({ meta: { changes: Number(db.prepare(query).run(...args).changes) } }),
    setting: async (owner, key, fallback = null) => { const row = db.prepare("SELECT value FROM settings WHERE owner=? AND key=?").get(owner, key); return row ? JSON.parse(row.value) : fallback; },
    setSetting: async (owner, key, value) => db.prepare("INSERT INTO settings VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value").run(owner, key, JSON.stringify(value)),
    event: async (...args) => events.push(args),
    decrypt: async () => { throw new Error("Distribution must never decrypt a signing key"); },
    rpc: async (owner, method, params) => {
      assert.equal(owner, "owner"); calls.push({ method, params });
      switch (method) {
        case "getMultipleAccounts": return { value: params[0].map((key) => accounts.get(key) ?? null) };
        case "getAccountInfo": return { value: accounts.get(params[0]) ?? null };
        case "getMinimumBalanceForRentExemption": return rent;
        case "getLatestBlockhash": return { value: { blockhash, lastValidBlockHeight: 500 } };
        case "getBlockHeight": return options.expired ? 600 : 400;
        case "getSignatureStatuses": return { value: [null] };
        case "getFeeForMessage": return { value: 5000 };
        case "simulateTransaction": return { value: { err: options.simulationError ? { InstructionError: [1, "fixture"] } : null, preBalances: [100000000], postBalances: [99995000] } };
        case "getTransaction": return observed;
        default: throw new Error("Unexpected RPC or broadcast: " + method);
      }
    },
  };
  const evaluatedModule = { exports: {} };
  const deps = { "./core": core, "./limits": { simulatedDebit: (s) => s.preBalances[0] - s.postBalances[0] }, "@pump-fun/pump-sdk": pump, "@pump-fun/pump-swap-sdk": swap, "@solana/web3.js": solana, "@solana/spl-token": spl, bs58: require("bs58") };
  vm.runInNewContext(source, {
    module: evaluatedModule, exports: evaluatedModule.exports, require: (name) => { assert(name in deps, "Unexpected import " + name); return deps[name]; },
    Buffer, Uint8Array, crypto: globalThis.crypto, BigInt, Date, console,
    fetch: () => { throw new Error("Network prohibited in offline tests"); },
  });
  function transactionResult(prepared, { mutate = false, failed = false, treasuryReceived = 200000 } = {}) {
    const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, "base64"));
    if (mutate) tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
    tx.sign([payer]);
    const before = tx.message.staticAccountKeys.map(() => 100000000);
    const after = [...before]; after[0] -= 5000;
    if (!failed) {
      for (const recipient of prepared.recipients) {
        const index = tx.message.staticAccountKeys.findIndex((key) => key.toBase58() === recipient.wallet);
        after[index] += recipient.wallet === treasury.publicKey.toBase58() ? treasuryReceived : 800000;
      }
    }
    observed = { transaction: [Buffer.from(tx.serialize()).toString("base64"), "base64"], meta: { err: failed ? { InstructionError: [1, "fixture"] } : null, fee: 5000, preBalances: before, postBalances: after } };
    return bs58.encode(tx.signatures[0]);
  }
  return { api: evaluatedModule.exports, creator, treasury, payer, mint, sharing, accounts, calls, events, get, set, transactionResult };
}

test("builds an unsigned SOL distribution from real SDK accounts without requiring a main coin", async (t) => {
  const h = await harness(t);
  const result = await h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58());
  const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
  assert.equal(result.estimatedDistributionLamports, 1000000);
  assert.equal(result.estimatedTreasuryLamports, 200000);
  assert.equal(result.estimatedFeeLamports, 5000);
  assert.equal(result.graduated, false); assert.equal(result.sweepsAmm, false);
  assert.equal(tx.message.compiledInstructions.length, 2);
  assert.equal(tx.message.staticAccountKeys[tx.message.compiledInstructions[1].programIdIndex].toBase58(), pump.PUMP_PROGRAM_ID.toBase58());
  assert(tx.signatures.every((signature) => signature.every((byte) => byte === 0)));
  assert(tx.serialize().length <= 1232);
  assert.equal(h.get("fee_distribution_draft").id, result.id);
  assert(!h.calls.some((call) => call.method === "sendTransaction"));
});

test("graduated coins sweep only an initialized verified AMM vault before distribution", async (t) => {
  const h = await harness(t, { graduated: true });
  const result = await h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58());
  const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
  assert.equal(result.estimatedDistributionLamports, 3000000);
  assert.equal(result.estimatedTreasuryLamports, 600000);
  assert.equal(result.sweepsAmm, true);
  assert.equal(tx.message.compiledInstructions.length, 3);
  assert.equal(tx.message.staticAccountKeys[tx.message.compiledInstructions[1].programIdIndex].toBase58(), pump.PUMP_AMM_PROGRAM_ID.toBase58());
  const empty = await harness(t, { graduated: true, noAmmVault: true });
  const second = await empty.api.prepareFeeDistribution("owner", "draft", empty.payer.publicKey.toBase58());
  assert.equal(second.graduated, true); assert.equal(second.sweepsAmm, false);
});

test("fee-sharing setup accepts an operations treasury with no main-coin mint", async (t) => {
  const h = await harness(t);
  h.accounts.delete(h.sharing.toBase58());
  const result = await h.api.prepareSupport("owner", "draft");
  assert.equal(result.treasury, h.treasury.publicKey.toBase58());
  assert.equal(result.mainCoin, "");
  assert.equal(result.status, "prepared");
});

test("foreign drafts, unsupported quotes and mutable or paused sharing configs are rejected", async (t) => {
  const h = await harness(t);
  await assert.rejects(h.api.prepareFeeDistribution("other", "draft", h.payer.publicKey.toBase58()), /Confirm this coin launch/);
  for (const options of [{ config: { adminRevoked: false } }, { config: { status: { paused: {} } } }, { curve: { quoteMint: Keypair.generate().publicKey } }, { curve: { isHolderReward: true } }]) {
    const invalid = await harness(t, options);
    await assert.rejects(invalid.api.prepareFeeDistribution("owner", "draft", invalid.payer.publicKey.toBase58()));
    assert.equal(invalid.get("fee_distribution_draft"), null);
  }
});

test("rejects a forged account owner, wrong pool creator and absent treasury recipient", async (t) => {
  const h = await harness(t);
  h.accounts.get(h.sharing.toBase58()).owner = SystemProgram.programId.toBase58();
  await assert.rejects(h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58()), /expected program/);
  const wrongPool = await harness(t, { graduated: true, pool: { coinCreator: Keypair.generate().publicKey } });
  await assert.rejects(wrongPool.api.prepareFeeDistribution("owner", "draft", wrongPool.payer.publicKey.toBase58()), /does not match/);
  const missingTreasury = await harness(t);
  missingTreasury.set("support", { treasury: Keypair.generate().publicKey.toBase58() });
  await assert.rejects(missingTreasury.api.prepareFeeDistribution("owner", "draft", missingTreasury.payer.publicKey.toBase58()), /do not include/);
});

test("no fees or failed simulation never creates a reviewable transaction", async (t) => {
  for (const options of [{ curveFees: 0 }, { simulationError: true }]) {
    const h = await harness(t, options);
    await assert.rejects(h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58()));
    assert.equal(h.get("fee_distribution_draft"), null);
  }
});

test("concurrent preparations cannot overwrite the message under wallet review", async (t) => {
  const h = await harness(t);
  const results = await Promise.allSettled([
    h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58()),
    h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58()),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected")[0].reason.status, 409);
  const stored = h.get("fee_distribution_draft");
  const repeated = await h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58());
  assert.equal(repeated.id, stored.id);
  await assert.rejects(h.api.prepareFeeDistribution("owner", "draft", Keypair.generate().publicKey.toBase58()), /another wallet/);
});

test("confirmation rejects a different message and records actual payout including a recipient payer", async (t) => {
  const h = await harness(t, { treasuryPayer: true });
  const prepared = await h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58());
  const wrong = h.transactionResult(prepared, { mutate: true });
  await assert.rejects(h.api.confirmFeeDistribution("owner", "draft", wrong), /exactly match/);
  assert.equal(h.get("fee_distribution_draft").status, "prepared");
  const signature = h.transactionResult(prepared, { treasuryReceived: 250000 });
  const confirmed = await h.api.confirmFeeDistribution("owner", "draft", signature);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.receivedLamports, 250000);
  assert.equal(confirmed.receivedSol, "0.000250000");
  assert.equal(confirmed.feeLamports, 5000);
  assert.equal(h.events.length, 1);
  const again = await h.api.confirmFeeDistribution("owner", "draft", signature);
  assert.equal(again.id, confirmed.id); assert.equal(h.events.length, 1);
});

test("pending and chain-failed transactions never report a collected amount", async (t) => {
  const h = await harness(t);
  const prepared = await h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58());
  const unsigned = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, "base64"));
  unsigned.sign([h.payer]);
  const signature = bs58.encode(unsigned.signatures[0]);
  const pending = await h.api.confirmFeeDistribution("owner", "draft", signature);
  assert.equal(pending.status, "pending"); assert.equal(pending.receivedLamports, undefined);
  h.transactionResult(prepared, { failed: true });
  const failed = await h.api.confirmFeeDistribution("owner", "draft", signature);
  assert.equal(failed.status, "failed"); assert.equal(failed.receivedLamports, undefined);
});

test("a dropped signature expires only after finalized block expiry and a history check", async (t) => {
  const h = await harness(t, { expired: true });
  const prepared = await h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58());
  const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, "base64"));
  tx.sign([h.payer]);
  const expired = await h.api.confirmFeeDistribution("owner", "draft", bs58.encode(tx.signatures[0]));
  assert.equal(expired.status, "expired");
  assert.equal(expired.receivedLamports, undefined);
  const check = h.calls.find((call) => call.method === "getSignatureStatuses");
  assert.equal(check.params[1].searchTransactionHistory, true);
  const next = await h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58());
  assert.notEqual(next.id, prepared.id);
});

test("an owned pending submission is recoverable after expiry with a different connected wallet", async (t) => {
  const h = await harness(t, { expired: true });
  const prepared = await h.api.prepareFeeDistribution("owner", "draft", h.payer.publicKey.toBase58());
  const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, "base64"));
  tx.sign([h.payer]);
  const signature = bs58.encode(tx.signatures[0]);
  h.set("fee_distribution_draft", { ...prepared, status: "submitted", signature });
  const previousCallCount = h.calls.length;
  const recovered = await h.api.prepareFeeDistribution("owner", "draft", Keypair.generate().publicKey.toBase58());
  assert.equal(recovered.id, prepared.id);
  assert.equal(recovered.status, "submitted");
  assert.equal(recovered.signature, signature);
  assert.equal(recovered.wallet, h.payer.publicKey.toBase58());
  assert.equal(recovered.transaction, prepared.transaction);
  assert.equal(h.calls.length, previousCallCount, "recovery must not build or simulate another transaction");
  await assert.rejects(h.api.prepareFeeDistribution("other", "draft", h.payer.publicKey.toBase58()), /Confirm this coin launch/);
  const expired = await h.api.confirmFeeDistribution("owner", "draft", recovered.signature);
  assert.equal(expired.status, "expired");
});
