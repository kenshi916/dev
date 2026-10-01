import { createRequire } from "node:module";
const { PUMP_SDK } = createRequire(import.meta.url)("@pump-fun/pump-sdk");
import {
  Keypair,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import assert from "node:assert/strict";
const mint = Keypair.generate(),
  payer = Keypair.generate();
const ix = await PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name: "Offline QA",
  symbol: "QA",
  uri: "https://ipfs.io/ipfs/bafkreiofflinetest",
  creator: payer.publicKey,
  user: payer.publicKey,
  mayhemMode: false,
  cashback: false,
  holderReward: false,
});
assert.equal(
  ix.programId.toBase58(),
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);
assert.deepEqual(
  [...ix.data.subarray(0, 8)],
  [214, 144, 76, 236, 95, 139, 49, 180],
);
assert.equal(ix.keys[0].pubkey.toBase58(), mint.publicKey.toBase58());
assert.equal(ix.keys[5].pubkey.toBase58(), payer.publicKey.toBase58());
const tx = new VersionedTransaction(
  new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 350000 }),
      ix,
    ],
  }).compileToV0Message(),
);
assert(tx.serialize().length <= 1232);
assert.equal(tx.message.compiledInstructions.length, 2);
console.log(
  JSON.stringify({
    passed: 6,
    transactionBytes: tx.serialize().length,
    networkRequests: 0,
    broadcasts: 0,
  }),
);
