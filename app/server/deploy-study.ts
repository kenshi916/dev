import { change, rows, setSetting, now } from "./core";
import { refreshWallets, TRACKED_WALLET } from "./signals";

export async function studyDeploys(owner: string, refresh = true) {
  await change("INSERT INTO tracks(id,owner,kind,query,label) SELECT ?,?,'wallet',?,'bwa deploy study' WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE owner=? AND kind='wallet' AND query=?) ON CONFLICT(id) DO NOTHING",
    "bwa-study:" + owner, owner, TRACKED_WALLET, owner, TRACKED_WALLET);
  let refreshStatus = "Saved observations";
  if (refresh) {
    try { await refreshWallets(owner, TRACKED_WALLET); refreshStatus = "Refresh checked"; }
    catch { refreshStatus = "Refresh unavailable; saved observations only"; }
  }
  const saved = await rows("SELECT text,url,created_at FROM signals WHERE owner=? AND kind='wallet' AND source=? ORDER BY created_at DESC LIMIT 100", owner, TRACKED_WALLET);
  const deployments = saved.flatMap(row => {
    try {
      const data = JSON.parse(row.text);
      if (data.observation !== "launch" || data.wallet !== TRACKED_WALLET || data.launchingUser !== TRACKED_WALLET) return [];
      return [{ name: data.name, symbol: data.symbol, mint: data.mint, description: data.description,
        declaredCreator: data.declaredCreator, observedAt: row.created_at,
        deployedAt: typeof data.blockTime === "number" && Number.isFinite(data.blockTime) ? new Date(data.blockTime * 1000).toISOString() : null,
        transaction: row.url }];
    } catch { return []; }
  }).slice(0, 8);
  const result = { wallet: TRACKED_WALLET, checkedAt: now(), refreshStatus, deployments,
    scope: "Up to 12 recent transactions per scan. Study naming, themes and observed deployment cadence. This is a partial history; it cannot establish lifetime PNL or why a coin made money." };
  await setSetting(owner, "deploy_study", result);
  return result;
}
