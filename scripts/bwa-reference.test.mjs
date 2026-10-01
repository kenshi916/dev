import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import ts from "typescript";

// Offline checks of the dated RPC archive. These validate the displayed accounting
// against saved evidence; they do not claim that five transactions are a full history.
const directory = new URL("../research/bwa-live-20261001/", import.meta.url);
const report = JSON.parse(readFileSync(new URL("report.json", directory), "utf8"));
const archive = Object.fromEntries(report.observations.map((observation) => [
  observation.label,
  JSON.parse(readFileSync(new URL(observation.file, directory), "utf8")),
]));
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/bwa-reference.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module, exports: module.exports });
const reference = JSON.parse(JSON.stringify(module.exports.BWA_REFERENCE_CASE));
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SYSTEM = "11111111111111111111111111111111";
const WSOL = "So11111111111111111111111111111111111111112";
const tx = (label) => archive[label].response.result;
const discriminator = (name) => createHash("sha256").update("global:" + name).digest().subarray(0, 8);
const isPumpInstruction = (instruction, name) => instruction.programId === PUMP
  && typeof instruction.data === "string"
  && Buffer.from(bs58.decode(instruction.data)).subarray(0, 8).equals(discriminator(name));
const indexOf = (transaction, address) => {
  const index = transaction.transaction.message.accountKeys.findIndex((key) => key.pubkey === address);
  assert.notEqual(index, -1, "account must occur in the transaction");
  return index;
};
const delta = (transaction, address = report.wallet) => {
  const index = indexOf(transaction, address);
  const before = transaction.meta.preBalances[index], after = transaction.meta.postBalances[index];
  assert.ok(Number.isSafeInteger(before) && Number.isSafeInteger(after));
  return BigInt(after) - BigInt(before);
};
const ownedToken = (transaction, when) => {
  const balances = transaction.meta[when + "TokenBalances"].filter((balance) =>
    balance.owner === report.wallet && balance.mint === report.deployment.mint);
  assert.equal(balances.length, 1);
  const balance = balances[0];
  return {
    address: transaction.transaction.message.accountKeys[balance.accountIndex].pubkey,
    amount: BigInt(balance.uiTokenAmount.amount),
    decimals: balance.uiTokenAmount.decimals,
  };
};

test("the reference archive hashes, RPC provenance and explorer links match all five saved transactions", () => {
  assert.equal(report.observations.length, 5);
  assert.deepEqual(readdirSync(directory).sort(), ["report.json", ...report.observations.map((item) => item.file)].sort());
  assert.equal(new Set(report.observations.map((item) => item.signature)).size, 5);
  for (const observation of report.observations) {
    const bytes = readFileSync(new URL(observation.file, directory));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), observation.sha256);
    const envelope = archive[observation.label], transaction = envelope.response.result;
    assert.equal(envelope.source.endpoint, "https://api.mainnet-beta.solana.com");
    assert.equal(envelope.source.method, "getTransaction");
    assert.deepEqual(envelope.source.params, [observation.signature, {
      encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed",
    }]);
    assert.equal(envelope.fetchedAt, observation.fetchedAt);
    assert.ok(Number.isFinite(Date.parse(envelope.fetchedAt)));
    assert.ok(Date.parse(report.fetchedAt) >= Date.parse(envelope.fetchedAt));
    assert.equal(transaction.transaction.signatures[0], observation.signature);
    assert.equal(transaction.meta.err, null);
    assert.equal(transaction.version, observation.version);
    assert.equal(transaction.blockTime, observation.blockTime);
    assert.equal(new Date(transaction.blockTime * 1000).toISOString(), observation.dateUtc);
    assert.equal(transaction.transaction.message.accountKeys[indexOf(transaction, report.wallet)].signer, true);
    assert.equal(delta(transaction), BigInt(observation.walletDeltaLamports));
    assert.equal(transaction.meta.fee, observation.networkFeeLamports);
    assert.deepEqual(transaction.meta.preTokenBalances.filter((item) => item.owner === report.wallet), observation.ownedTokensBefore);
    assert.deepEqual(transaction.meta.postTokenBalances.filter((item) => item.owner === report.wallet), observation.ownedTokensAfter);
    assert.equal(observation.sourceUrl, "https://solscan.io/tx/" + observation.signature);
  }
  assert.equal(reference.checkedAt, report.fetchedAt);
  assert.equal(reference.scope, report.scope);
  assert.deepEqual(reference.sources, report.observations.map((item) => ({ label: item.label, url: item.sourceUrl })));
});

test("CreateV2 bytes identify the displayed wallet, mint, name and timestamp without relying on captions", () => {
  const transaction = tx("create"), instructions = transaction.transaction.message.instructions;
  const creates = instructions.filter((instruction) => isPumpInstruction(instruction, "create_v2"));
  assert.equal(creates.length, 1);
  const create = creates[0], data = Buffer.from(bs58.decode(create.data));
  let offset = 8;
  const readString = () => {
    assert.ok(offset + 4 <= data.length);
    const length = data.readUInt32LE(offset); offset += 4;
    assert.ok(length <= 800 && offset + length <= data.length);
    const value = data.subarray(offset, offset + length).toString("utf8"); offset += length;
    return value;
  };
  const decoded = { name: readString(), symbol: readString(), metadataUri: readString() };
  assert.ok(offset + 32 <= data.length);
  const creator = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  assert.equal(create.accounts[5], report.wallet);
  assert.equal(creator, report.wallet);
  assert.equal(report.deployment.launchingUser, report.wallet);
  assert.equal(report.deployment.declaredCreator, creator);
  assert.equal(create.accounts[0], report.deployment.mint);
  for (const field of ["name", "symbol", "metadataUri"]) assert.equal(decoded[field], report.deployment[field]);
  for (const field of ["name", "symbol", "mint"]) assert.equal(reference[field], report.deployment[field]);
  assert.equal(reference.wallet, report.wallet);
  assert.equal(reference.deployedAt, new Date(transaction.blockTime * 1000).toISOString());
  assert.equal(reference.deployedAt, report.deployment.dateUtc);
  assert.equal(Date.parse(report.deployment.dateLosAngeles), transaction.blockTime * 1000);
  const buys = instructions.filter((instruction) => isPumpInstruction(instruction, "buy_exact_sol_in"));
  assert.equal(buys.length, 1);
  assert.equal(buys[0].accounts[2], report.deployment.mint);
  assert.equal(buys[0].accounts[6], report.wallet);
});

test("displayed negative cash flow follows actual balance deltas with fees already included", () => {
  const create = delta(tx("create")), setup = delta(tx("fee-setup"));
  const sales = [delta(tx("sell-one")), delta(tx("sell-two"))];
  assert.equal(-create, BigInt(report.deployment.launchAndBuyDebitLamports));
  assert.deepEqual(sales, report.deployment.sellNetCreditsLamports.map(BigInt));
  const tradeCashflow = create + sales[0] + sales[1], withSetup = tradeCashflow + setup;
  assert.equal(tradeCashflow, BigInt(report.deployment.observedLaunchTradeCashflowLamports));
  assert.equal(withSetup, BigInt(report.deployment.observedCashflowIncludingSetupLamports));
  assert.equal(-setup, BigInt(report.deployment.interveningSetupDebitLamports));
  assert.equal(BigInt(reference.launchTradeCashflowLamports), tradeCashflow);
  assert.equal(BigInt(reference.cashflowLamports), withSetup);
  assert.equal(BigInt(reference.setupDebitLamports), -setup);
  assert.ok(withSetup < 0n);
  assert.equal(tx("fee-setup").blockTime - tx("create").blockTime, 1);
  assert.ok(tx("fee-setup").transaction.message.instructions.some((instruction) =>
    instruction.programId === "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
    && instruction.accounts?.includes(report.deployment.mint)));
});

test("one identified token account goes from the launch purchase to zero across the two sales in six seconds", () => {
  const create = tx("create"), first = tx("sell-one"), last = tx("sell-two");
  const bought = ownedToken(create, "post"), beforeFirst = ownedToken(first, "pre"), afterFirst = ownedToken(first, "post");
  const beforeLast = ownedToken(last, "pre"), afterLast = ownedToken(last, "post");
  for (const token of [beforeFirst, afterFirst, beforeLast, afterLast]) {
    assert.equal(token.address, bought.address);
    assert.equal(token.decimals, report.deployment.tokenDecimals);
  }
  assert.equal(create.meta.preTokenBalances.filter((item) => item.mint === report.deployment.mint && item.owner === report.wallet).length, 0);
  assert.equal(bought.amount, BigInt(report.deployment.boughtTokenRaw));
  assert.equal(bought.amount, beforeFirst.amount);
  assert.equal(afterFirst.amount, beforeLast.amount);
  assert.ok(afterFirst.amount > 0n && afterFirst.amount < beforeFirst.amount);
  assert.equal(afterLast.amount, 0n);
  assert.equal(report.deployment.remainingTokensOnObservedAccount, "0");
  for (const [transaction, before, after] of [[first, beforeFirst, afterFirst], [last, beforeLast, afterLast]]) {
    const sales = transaction.transaction.message.instructions.filter((instruction) => isPumpInstruction(instruction, "sell"));
    assert.equal(sales.length, 1);
    assert.equal(sales[0].accounts[2], report.deployment.mint);
    assert.equal(sales[0].accounts[5], bought.address);
    assert.equal(sales[0].accounts[6], report.wallet);
    const data = Buffer.from(bs58.decode(sales[0].data));
    assert.equal(data.readBigUInt64LE(8), before.amount - after.amount);
  }
  assert.equal(last.blockTime - create.blockTime, 6);
  assert.equal(reference.holdingSeconds, last.blockTime - create.blockTime);
  assert.equal(report.deployment.holdingSeconds, reference.holdingSeconds);
  // Zero token holdings close the observed position, not the on-chain token account.
  assert.ok(last.meta.postBalances[indexOf(last, bought.address)] > 0);
});

test("creator income is the verified vault transfer, excluding the wrapped-SOL rent refund", () => {
  const transaction = tx("aggregate-fee-collection"), collection = report.creatorFeeCollection;
  const vault = PublicKey.findProgramAddressSync([
    Buffer.from("creator-vault"), new PublicKey(report.wallet).toBuffer(),
  ], new PublicKey(PUMP))[0].toBase58();
  assert.equal(vault, collection.creatorVault);
  assert.equal(vault, collection.expectedCreatorVault);
  const top = transaction.transaction.message.instructions;
  const collectIndex = top.findIndex((instruction) => isPumpInstruction(instruction, "collect_creator_fee"));
  assert.ok(collectIndex >= 0);
  assert.equal(top[collectIndex].accounts[0], report.wallet);
  assert.equal(top[collectIndex].accounts[1], vault);
  const transfers = transaction.meta.innerInstructions.find((group) => group.index === collectIndex).instructions.filter((instruction) =>
    instruction.programId === SYSTEM && instruction.parsed?.type === "transfer"
    && instruction.parsed.info.source === vault && instruction.parsed.info.destination === report.wallet);
  assert.equal(transfers.length, 1);
  const creatorIncome = BigInt(transfers[0].parsed.info.lamports);
  assert.equal(-delta(transaction, vault), creatorIncome);
  assert.equal(creatorIncome, BigInt(collection.verifiedNativeCreatorVaultTransferLamports));
  assert.equal(creatorIncome, BigInt(reference.aggregateCreatorReceiptLamports));
  const closed = top.filter((instruction) => instruction.parsed?.type === "closeAccount"
    && instruction.parsed.info.owner === report.wallet && instruction.parsed.info.destination === report.wallet);
  assert.equal(closed.length, 1);
  const closedIndex = indexOf(transaction, closed[0].parsed.info.account);
  const token = transaction.meta.preTokenBalances.find((balance) => balance.accountIndex === closedIndex);
  assert.equal(token.mint, WSOL);
  assert.equal(token.owner, report.wallet);
  assert.equal(token.uiTokenAmount.amount, "0");
  assert.equal(transaction.meta.postBalances[closedIndex], 0);
  const refund = BigInt(transaction.meta.preBalances[closedIndex]);
  assert.equal(refund, BigInt(collection.closedWrappedSolAccountRefundLamports));
  assert.equal(transaction.meta.fee, collection.networkFeeLamports);
  assert.equal(delta(transaction), creatorIncome + refund - BigInt(transaction.meta.fee));
  assert.equal(delta(transaction), BigInt(collection.walletNetDeltaLamports));
  assert.notEqual(delta(transaction), creatorIncome);
});
