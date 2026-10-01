import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url), { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } = require("@solana/web3.js"), bs58 = require("bs58").default;
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/server/coin-accounting.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { module, exports: module.exports, require, Buffer });
const { verifiedDebit, coinEarnings } = module.exports;

test("launch cost uses exact signed message balances, never an estimate or duplicate fee subtraction", () => {
  const payer = Keypair.generate(), recipient = Keypair.generate();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient.publicKey, lamports: 1000 })] }).compileToV0Message());
  const prepared = Buffer.from(tx.serialize()).toString("base64"); tx.sign([payer]);
  const signature = bs58.encode(tx.signatures[0]), observed = { transaction: [Buffer.from(tx.serialize()).toString("base64"), "base64"], meta: { err: null, fee: 5000, preBalances: [100000], postBalances: [94000] } };
  assert.equal(verifiedDebit(observed, prepared, signature, payer.publicKey.toBase58()), 6000);
  assert.equal(verifiedDebit(observed, prepared, signature, recipient.publicKey.toBase58()), null);
  assert.equal(verifiedDebit(observed, prepared, "wrong-signature", payer.publicKey.toBase58()), null);
  assert.equal(verifiedDebit({ ...observed, meta: { err: null } }, prepared, signature, payer.publicKey.toBase58()), null);
  tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  assert.equal(verifiedDebit(observed, Buffer.from(tx.serialize()).toString("base64"), signature, payer.publicKey.toBase58()), null);
});

const launch = { verification: "server-rpc", mint: "mint", creator: "creator", launchDebitLamports: 20000 };
const receipt = { signature: "one", mint: "mint", creator: "creator", verification: "server-rpc", creatorReceivedLamports: 100000, creatorCollectionCostLamports: 5000, setupDebitLamports: 10000 };
test("recorded net counts creator share once and includes failed collection fees", () => {
  const failed = { ...receipt, signature: "failed", status: "failed", creatorReceivedLamports: 0 };
  const result = coinEarnings(launch, [failed, receipt, receipt]);
  assert.equal(result.creatorFeesLamports, 100000);
  assert.equal(result.collectionCostLamports, 10000);
  assert.equal(result.netLamports, 60000);
  assert.equal(coinEarnings(launch, [{ ...receipt, creatorReceivedLamports: 1000 }]).netLamports, -34000);
});
test("missing provenance, beneficiary or costs never produces a profit number", () => {
  assert.equal(coinEarnings(launch, []).creatorFeesLamports, null);
  for (const change of [{ verification: "owner-rpc" }, { creator: "treasury" }, { mint: "foreign" }, { creatorReceivedLamports: null }])
    assert.equal(coinEarnings(launch, [{ ...receipt, ...change }]).netLamports, null);
  assert.equal(coinEarnings(launch, [{ ...receipt, setupDebitLamports: null }]).netLamports, null);
  assert.equal(coinEarnings({ ...launch, launchDebitLamports: null }, [receipt]).netLamports, null);
  assert.equal(coinEarnings(launch, [{ ...receipt, setupDebitLamports: null }, { ...receipt, signature: "new" }]).netLamports, 160000);
});
