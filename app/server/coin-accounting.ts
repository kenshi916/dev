import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

export const lamports = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

// Only exact signed messages can attribute a payer's debit to a Dev action.
export function verifiedDebit(observed: any, transaction: string, signature: string, payer: string): number | null {
  try {
    if (observed?.meta?.err !== null || observed.transaction?.[1] !== "base64") return null;
    const actual = VersionedTransaction.deserialize(Buffer.from(observed.transaction[0], "base64"));
    const expected = VersionedTransaction.deserialize(Buffer.from(transaction, "base64"));
    if (Buffer.compare(Buffer.from(actual.message.serialize()), Buffer.from(expected.message.serialize())) !== 0 ||
      bs58.encode(actual.signatures[0]) !== signature || actual.message.staticAccountKeys[0].toBase58() !== payer) return null;
    const before = observed.meta.preBalances?.[0], after = observed.meta.postBalances?.[0];
    return lamports(before) && lamports(after) && before >= after ? before - after : null;
  } catch { return null; }
}

export function coinEarnings(launch: any, receipts: any[]) {
  const empty = { creatorFeesLamports: null, launchCostLamports: null, setupCostLamports: null, collectionCostLamports: null, netLamports: null, collections: 0 };
  if (launch?.verification !== "server-rpc") return empty;
  const launchCost = lamports(launch.launchDebitLamports) ? launch.launchDebitLamports : null;
  const records = [...new Map(receipts.filter(r => r?.signature).map(r => [r.signature, r])).values()];
  if (!records.length || records.some(r => r.verification !== "server-rpc" || r.mint !== launch.mint || r.creator !== launch.creator ||
      !lamports(r.creatorReceivedLamports) || !lamports(r.creatorCollectionCostLamports))) return { ...empty, launchCostLamports: launchCost };
  const creatorFees = records.reduce((n, r) => n + r.creatorReceivedLamports, 0);
  const collectionCost = records.reduce((n, r) => n + r.creatorCollectionCostLamports, 0);
  const setupCosts = [...new Set(records.map(r => r.setupDebitLamports).filter(lamports))];
  const setupCost = setupCosts.length === 1 ? setupCosts[0] : null;
  if (!lamports(creatorFees) || !lamports(collectionCost)) return { ...empty, launchCostLamports: launchCost };
  const net = launchCost !== null && setupCost !== null ? creatorFees - launchCost - setupCost - collectionCost : null;
  return { creatorFeesLamports: creatorFees, launchCostLamports: launchCost, setupCostLamports: setupCost,
    collectionCostLamports: collectionCost, netLamports: Number.isSafeInteger(net) ? net : null, collections: records.length };
}
