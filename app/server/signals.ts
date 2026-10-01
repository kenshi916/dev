import { AppError, change, event, external, now, one, rows, rpc } from "./core";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { analyzeWalletSample, PUMP_PROGRAM, type WalletSample } from "./wallet-analysis";
export const TRACKED_WALLET = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
export { refreshTweets } from "./twitter-provider";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function launchInTransaction(value: unknown, wallet: string) {
  const tx = object(value), message = object(object(tx.transaction).message), meta = object(tx.meta);
  const keys = array(message.accountKeys);
  if (!keys.some((key) => object(key).pubkey === wallet && object(key).signer === true)) return null;
  const instructions = [
    ...array(message.instructions),
    ...array(meta.innerInstructions).flatMap((group) => array(object(group).instructions)),
  ].map(object);
  for (const ix of instructions) {
    if (ix.programId !== PUMP_PROGRAM || typeof ix.data !== "string") continue;
    try {
      const bytes = Buffer.from(bs58.decode(ix.data));
      const discriminator = Array.from(bytes.subarray(0, 8)).join(",");
      if (!["24,30,200,40,5,28,7,119", "214,144,76,236,95,139,49,180"].includes(discriminator)) continue;
      const accounts = array(ix.accounts);
      const launchingUser = accounts[bytes[0] === 214 ? 5 : 7];
      if (launchingUser !== wallet) continue;
      let offset = 8;
      const readString = (max: number) => {
        if (offset + 4 > bytes.length) throw new Error("Invalid data");
        const len = bytes.readUInt32LE(offset); offset += 4;
        if (len > max || offset + len > bytes.length) throw new Error("Invalid length");
        const value = bytes.subarray(offset, offset + len).toString("utf8"); offset += len;
        return value;
      };
      const name = readString(128), symbol = readString(52), uri = readString(800);
      if (offset + 32 > bytes.length) continue;
      const declaredCreator = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
      if (typeof accounts[0] !== "string") continue;
      const mint = new PublicKey(accounts[0]).toBase58();
      return { launchingUser, declaredCreator, name, symbol, uri, mint };
    } catch { /* Unknown instruction versions are not treated as launches. */ }
  }
  return null;
}

export async function refreshWallets(owner: string, onlyWallet?: string, options: { limit?: number } = {}) {
  const limit = Math.max(12, Math.min(80, Math.floor(options.limit || 12)));
  const tracks = onlyWallet
    ? await rows("SELECT * FROM tracks WHERE owner=? AND kind='wallet' AND query=?", owner, onlyWallet)
    : await rows("SELECT * FROM tracks WHERE owner=? AND kind='wallet'", owner);
  if (!tracks.length) throw new AppError("Add a developer wallet first.");
  let examined = 0, launches = 0, trades = 0, balanceChanges = 0, matchedRoundTrips = 0, unavailableTransactions = 0;
  for (const track of tracks) {
    const claim = await change(
      "UPDATE tracks SET last_checked=? WHERE id=? AND owner=? AND (last_checked IS NULL OR last_checked<?)",
      now(), track.id, owner, new Date(Date.now() - 120000).toISOString(),
    );
    if (!claim.meta.changes) continue;
    const signatures = await rpc(owner, "getSignaturesForAddress", [track.query, { limit, commitment: "confirmed" }]);
    if (!Array.isArray(signatures)) throw new AppError("Solana RPC returned an invalid wallet history.", 502);
    const samples: WalletSample[] = [];
    // Re-read the bounded contiguous window, including saved signatures, to avoid matching
    // across unknown history between refreshes or assuming transfers were purchases.
    for (const value of signatures.slice(0, limit)) {
      const item = object(value);
      if (typeof item.signature !== "string") continue;
      if (item.err) { samples.push({ signature: item.signature, transaction: null }); continue; }
      let transaction: unknown = null;
      try {
        transaction = await rpc(owner, "getTransaction", [item.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
      } catch (error) {
        // An unavailable RPC is an access problem, not an empty/profitable wallet history.
        if (!samples.some((sample) => sample.transaction)) throw error;
      }
      examined++;
      samples.push({ signature: item.signature, transaction });
    }
    const scan = analyzeWalletSample(samples, track.query);
    matchedRoundTrips += scan.roundTrips.length;
    unavailableTransactions += scan.unavailableTransactions;
    for (const analysis of scan.observations) {
      const tx = samples.find((sample) => sample.signature === analysis.signature)?.transaction;
      const launch = launchInTransaction(tx, track.query);
      if (!launch && !analysis.trade && analysis.native.changeLamports === "0" && !analysis.tokens.length) continue;
      let description: string | null = null, image: string | null = null;
      if (launch) {
        try {
          const response = await external("https://frontend-api-v3.pump.fun/coins-v2/" + launch.mint, {}, "pump.fun");
          const coin = object(await response.json());
          description = typeof coin.description === "string" ? coin.description.slice(0, 600) : null;
          image = typeof coin.image_uri === "string" && /^https:\/\//.test(coin.image_uri) ? coin.image_uri.slice(0, 1200) : null;
        } catch { /* On-chain evidence remains available without metadata. */ }
      }
      const observation = launch ? "launch" : analysis.kind;
      const summary = launch ? `Observed pump.fun launch ${launch.name} ($${launch.symbol}). ${analysis.summary}` : analysis.summary;
      // First property intentionally: model consumers may truncate signal text.
      const signal = JSON.stringify({
        summary, wallet: track.query, observation,
        name: launch?.name || (analysis.trade ? `${analysis.trade.protocol} ${analysis.trade.side}` : "Wallet balance change"),
        symbol: launch?.symbol || null,
        description: launch ? description || summary : summary,
        image,
        mint: launch?.mint || analysis.trade?.mint || null,
        blockTime: analysis.blockTime,
        ...(launch ? { launchingUser: launch.launchingUser, declaredCreator: launch.declaredCreator } : {}),
        analysis, note: analysis.note,
      });
      const old = await one("SELECT id FROM signals WHERE id=? AND owner=? AND source=?", analysis.signature, owner, track.query);
      const signalId = old?.id || "wallet:" + track.query + ":" + analysis.signature;
      await change(
        "INSERT INTO signals (id,owner,kind,source,text,created_at,url,likes) VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(id,owner) DO UPDATE SET text=excluded.text,url=excluded.url,created_at=excluded.created_at",
        signalId, owner, "wallet", track.query, signal,
        new Date((analysis.blockTime ?? Date.now() / 1000) * 1000).toISOString(), analysis.sourceUrl,
      );
      if (launch) launches++;
      if (analysis.trade) trades++;
      if (!launch && !analysis.trade) balanceChanges++;
    }
  }
  await event(owner, "", "wallets", `Examined ${examined} recent transactions; observed ${launches} launches, ${trades} Pump trades and ${balanceChanges} other balance changes. ${matchedRoundTrips} complete sampled token-account round trips; ${unavailableTransactions} unavailable/failed transactions. This is a limited sample, not total wallet PNL or a claim about motives.`);
  return { examined, launches, trades, balanceChanges, matchedRoundTrips, unavailableTransactions };
}
