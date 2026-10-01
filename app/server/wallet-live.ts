import { AppError, change, db, id, now, one, rows, rpc, setting } from "./core";
import { analyzeWalletTransaction, formatRaw, PUMP_PROGRAM } from "./wallet-analysis";
import { launchInTransaction, TRACKED_WALLET } from "./signals";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const STATE = "bwa_live_state", LOCK = "bwa_live_lock", PREFIX = "bwa_live_tx_";
const INTERVAL = 10000, PAGE = 100, HYDRATE = 10;
type Cursor = { anchor: string | null; anchorSlot?: number | null; cycleHead: string | null; cycleHeadSlot?: number | null; before: string | null; startedAt: string; lastSuccess: string | null; gap?: string; error?: string | null };
const initial = (): Cursor => ({ anchor: null, cycleHead: null, before: null, startedAt: now(), lastSuccess: null });
const txUrl = (s: string) => "https://solscan.io/tx/" + encodeURIComponent(s);
const safeTime = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 8_640_000_000_000 ? new Date(v * 1000).toISOString() : null;

export function explainWalletTransaction(tx: any, signature: string) {
  const analysis = analyzeWalletTransaction(tx, TRACKED_WALLET, signature);
  if (!analysis) return { action: tx?.meta?.err ? "Failed transaction" : "Unclassified transaction", explanation: tx?.meta?.err ? "The transaction failed on-chain. Its instructions did not complete; network fees can still be charged." : "No supported wallet action could be established from these transaction details.", mint: null, name: null, symbol: null, nativeChangeLamports: null, creatorReceiptLamports: null, tokens: [], caveat: "Not a profit calculation." };
  const launch = launchInTransaction(tx, TRACKED_WALLET), trade = analysis.trade;
  let creatorReceipt: bigint | null = null;
  const vault = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), new PublicKey(TRACKED_WALLET).toBuffer()], new PublicKey(PUMP_PROGRAM))[0].toBase58();
  for (const [index, instruction] of (tx.transaction?.message?.instructions || []).entries()) {
    if (instruction.programId !== PUMP_PROGRAM || instruction.accounts?.[0] !== TRACKED_WALLET || instruction.accounts?.[1] !== vault || typeof instruction.data !== "string") continue;
    try {
      if (Array.from(bs58.decode(instruction.data).subarray(0, 8)).join(",") !== "20,22,86,123,198,28,219,132") continue;
      const transfers = (tx.meta.innerInstructions || []).find((g: any) => g.index === index)?.instructions || [];
      for (const ix of transfers) {
        const info = ix.parsed?.info;
        if (ix.programId === "11111111111111111111111111111111" && ix.parsed?.type === "transfer" && info?.source === vault && info?.destination === TRACKED_WALLET && Number.isSafeInteger(info.lamports) && info.lamports >= 0) creatorReceipt = (creatorReceipt ?? BigInt(0)) + BigInt(info.lamports);
      }
    } catch { /* Unknown instructions are not fee receipts. */ }
  }
  const fullySold = trade?.side === "sell" && trade.tokenAccountAfterRaw === "0";
  const action = launch ? (trade?.side === "buy" ? "Launched + bought" : "Launched coin") : trade ? (trade.side === "buy" ? "Bought" : fullySold ? "Fully sold position" : "Sold part of position") : creatorReceipt !== null ? "Collected creator fees" : "Other wallet activity";
  const explanation = launch ? `The wallet signed a Pump create for ${launch.name} ($${launch.symbol}).${trade?.side === "buy" ? " It also bought tokens in the same transaction." : ""}` : trade ? `A decoded ${trade.protocol} ${trade.side} changed the observed token account by ${formatRaw(trade.tokenAmountRaw, trade.decimals)} tokens.${fullySold ? " This account now holds zero tokens; other accounts or wallets are outside this observation." : ""}` : creatorReceipt !== null ? `A supported creator-fee instruction transferred ${formatRaw(creatorReceipt.toString(), 9)} SOL from the derived creator vault. Rent refunds and other wallet credits are excluded from that receipt.` : "Balance changes were observed, but no supported direct Pump trade, create or native creator-fee receipt was established. Transfers, spam and other protocols can appear here.";
  return { action, explanation, mint: launch?.mint || trade?.mint || null, name: launch?.name || null, symbol: launch?.symbol || null,
    nativeChangeLamports: analysis.native.changeLamports, creatorReceiptLamports: creatorReceipt?.toString() ?? null,
    tokens: analysis.tokens.slice(0, 8).map(t => ({ mint: t.mint, change: formatRaw(t.changeRaw, t.decimals) })),
    caveat: "Observed action, not the wallet owner's motive. Wallet cashflow is not profit; creator-vault receipts are not allocated to one coin." };
}

export async function readWalletLive(owner: string) {
  const [cursor, configured, saved, pending] = await Promise.all([
    setting(owner, STATE, initial()), one("SELECT provider FROM secrets WHERE owner=? AND provider='rpc'", owner),
    rows("SELECT value FROM settings WHERE owner=? AND key LIKE 'bwa_live_tx_%' ORDER BY COALESCE(json_extract(value,'$.blockTime'),CAST(strftime('%s',json_extract(value,'$.seenAt')) AS INTEGER)) DESC,json_extract(value,'$.slot') DESC,json_extract(value,'$.seenAt') DESC LIMIT 60", owner),
    one("SELECT count(*) AS n FROM settings WHERE owner=? AND key LIKE 'bwa_live_tx_%' AND json_extract(value,'$.status')='pending'", owner),
  ]);
  return { wallet: TRACKED_WALLET, configured: !!configured, intervalMs: INTERVAL, status: !configured ? "needs_rpc" : cursor.error ? "error" : cursor.gap ? "gap" : cursor.cycleHead || pending.n ? "catching_up" : cursor.lastSuccess ? "current" : "idle",
    startedAt: cursor.startedAt, lastSuccess: cursor.lastSuccess, pending: pending.n, gap: cursor.gap || null, error: cursor.error || null,
    items: saved.map(row => JSON.parse(row.value)),
    scope: "Confirmed transactions referencing this wallet, starting with the latest 100 at connection. Newer address activity is paginated and retained; the latest 60 entries are shown. Token-account-only activity and unsupported protocols may be absent or unclassified. Updates run while this page is open, not on a hosted background worker." };
}

export async function refreshWalletLive(owner: string) {
  if (!await one("SELECT provider FROM secrets WHERE owner=? AND provider='rpc'", owner)) return readWalletLive(owner);
  const lease = id(), started = Date.now();
  const claim = await change("INSERT INTO settings(owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value WHERE COALESCE(json_extract(settings.value,'$.until'),0)<? AND COALESCE(json_extract(settings.value,'$.next'),0)<=?", owner, LOCK, JSON.stringify({ lease, until: started + 600000, next: started + INTERVAL }), started, started);
  if (!claim.meta.changes) return readWalletLive(owner);
  const cursor: Cursor = await setting(owner, STATE, initial());
  let committedCursor = { ...cursor };
  const deadline = AbortSignal.timeout(8000);
  const guard = "EXISTS(SELECT 1 FROM settings WHERE owner=? AND key=? AND json_extract(value,'$.lease')=?)";
  const guardedSave = (key: string, value: unknown) => db().prepare(`INSERT INTO settings(owner,key,value) SELECT ?,?,? WHERE ${guard} ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value`).bind(owner, key, JSON.stringify(value), owner, LOCK, lease);
  try {
    // Capture one page per tick. Keep the old anchor until it is explicitly found.
    // A burst larger than one page therefore continues instead of silently skipping.
    {
      const page: any = await rpc(owner, "getSignaturesForAddress", [TRACKED_WALLET, { limit: PAGE, commitment: "confirmed", ...(cursor.before ? { before: cursor.before } : {}), ...(cursor.anchorSlot ? { minContextSlot: cursor.anchorSlot } : {}) }], { signal: deadline });
      if (!Array.isArray(page) || page.length > PAGE || page.some((item: any) => typeof item?.signature !== "string")) throw new AppError("Invalid wallet history.");
      if (!cursor.before && cursor.anchorSlot && Number.isSafeInteger(page[0]?.slot) && page[0].slot < cursor.anchorSlot) throw new AppError("The RPC history is behind the saved boundary.");
      const anchorIndex = cursor.anchor ? page.findIndex((item: any) => item.signature === cursor.anchor) : -1;
      const fresh = anchorIndex >= 0 ? page.slice(0, anchorIndex) : page;
      const head = cursor.cycleHead || fresh[0]?.signature || cursor.anchor;
      const headSlot = cursor.cycleHeadSlot ?? (Number.isSafeInteger(fresh[0]?.slot) ? fresh[0].slot : cursor.anchorSlot ?? null);
      const statements = fresh.map((item: any) => db().prepare(`INSERT OR IGNORE INTO settings(owner,key,value) SELECT ?,?,? WHERE ${guard}`).bind(owner, PREFIX + item.signature, JSON.stringify({ signature: item.signature, url: txUrl(item.signature), blockTime: item.blockTime ?? null, slot: Number.isSafeInteger(item.slot) ? item.slot : null, occurredAt: safeTime(item.blockTime), seenAt: now(), status: item.err ? "failed" : "pending", action: item.err ? "Failed transaction" : "Awaiting transaction details", explanation: item.err ? "The chain reports a failed transaction; it is not a successful trade." : "Details are queued for verification.", retryAt: 0, attempts: 0 }), owner, LOCK, lease));
      if (!cursor.anchor || anchorIndex >= 0) { cursor.anchor = head; cursor.anchorSlot = headSlot; cursor.cycleHead = null; cursor.cycleHeadSlot = null; cursor.before = null; }
      else if (page.length < PAGE || page.at(-1)?.signature === cursor.before || (cursor.anchorSlot && Number.isSafeInteger(page.at(-1)?.slot) && page.at(-1).slot < cursor.anchorSlot)) { cursor.gap = "The provider did not return the previous history boundary. Coverage has a gap; newer history is retained without claiming completeness."; cursor.anchor = head; cursor.anchorSlot = headSlot; cursor.cycleHead = null; cursor.cycleHeadSlot = null; cursor.before = null; }
      else { cursor.cycleHead = head; cursor.cycleHeadSlot = headSlot; cursor.before = page.at(-1).signature; }
      cursor.lastSuccess = now(); cursor.error = null;
      await db().batch([...statements, guardedSave(STATE, cursor)]);
      committedCursor = { ...cursor };
    }
    const pending = await rows("SELECT key,value FROM settings WHERE owner=? AND key LIKE 'bwa_live_tx_%' AND json_extract(value,'$.status')='pending' AND COALESCE(json_extract(value,'$.retryAt'),0)<=? ORDER BY json_extract(value,'$.seenAt'),key LIMIT ?", owner, Date.now(), HYDRATE);
    for (const row of pending) {
      if (deadline.aborted || Date.now() - started >= 7500) break;
      const item = JSON.parse(row.value);
      try {
        const tx = await rpc(owner, "getTransaction", [item.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }], { signal: deadline });
        if (!tx?.meta) throw new AppError("Transaction details pending.");
        if (tx.transaction?.signatures?.[0] !== item.signature) throw new AppError("Transaction signature mismatch.");
        Object.assign(item, explainWalletTransaction(tx, item.signature), { status: tx.meta?.err ? "failed" : "confirmed", blockTime: tx.blockTime ?? item.blockTime, occurredAt: safeTime(tx.blockTime ?? item.blockTime), verifiedAt: now() });
      } catch {
        item.attempts++; item.retryAt = Date.now() + Math.min(300000, 10000 * 2 ** Math.min(item.attempts, 5));
        item.explanation = "Transaction details are unavailable. This entry stays pending and will retry; no trade or profit is assumed.";
      }
      await db().batch([guardedSave(row.key, item)]);
    }
  } catch {
    committedCursor.error = "The RPC could not complete the check. Saved activity remains visible; the history cursor is preserved for retry.";
    await db().batch([guardedSave(STATE, committedCursor)]);
  } finally {
    await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND json_extract(value,'$.lease')=?", JSON.stringify({ lease, until: 0, next: started + INTERVAL }), owner, LOCK, lease);
  }
  return readWalletLive(owner);
}
