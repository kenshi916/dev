import { change, rows, setSetting, now } from "./core";
import { refreshWallets, TRACKED_WALLET } from "./signals";
import { deployStudyEvidence } from "./deploy-study-evidence";
import { BWA_REFERENCE_CASE } from "../bwa-reference";

export async function studyDeploys(owner: string, refresh = true, deep = false) {
  await change("INSERT INTO tracks(id,owner,kind,query,label) SELECT ?,?,'wallet',?,'bwa deploy study' WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE owner=? AND kind='wallet' AND query=?) ON CONFLICT(id) DO NOTHING",
    "bwa-study:" + owner, owner, TRACKED_WALLET, owner, TRACKED_WALLET);
  let refreshStatus = "Saved observations";
  let refreshError: string | null = null;
  let scan: Awaited<ReturnType<typeof refreshWallets>> | null = null;
  if (refresh) {
    try {
      scan = await refreshWallets(owner, TRACKED_WALLET, { limit: deep ? 80 : 12 });
      refreshStatus = scan.examined ? "On-chain sample refreshed" : "Using the most recently saved sample";
    } catch {
      refreshStatus = "Refresh unavailable; saved observations only";
      refreshError = "The Solana RPC could not complete this wallet scan. Check the RPC connection and retry. No missing data is treated as zero earnings.";
    }
  }
  const saved = await rows("SELECT text,url,created_at FROM signals WHERE owner=? AND kind='wallet' AND source=? ORDER BY created_at DESC LIMIT 500", owner, TRACKED_WALLET);
  const evidence = deployStudyEvidence(saved, TRACKED_WALLET);
  const result = { version: 2, wallet: TRACKED_WALLET, checkedAt: now(), refreshStatus, refreshError, scan, ...evidence, referenceCase: BWA_REFERENCE_CASE,
    scope: "Manual studies inspect up to 80 recent wallet transactions; agent runs inspect up to 12. Up to 500 saved observations are reviewed without stitching separate windows into new trades. This is a partial history, not lifetime PNL or proof of why a coin worked." };
  await setSetting(owner, "deploy_study", result);
  return result;
}
