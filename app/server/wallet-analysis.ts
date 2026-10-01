import bs58 from "bs58";

// Discriminators/account order verified against Pump's public IDLs and the installed SDK:
// https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
// https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_SWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SYSTEM = "11111111111111111111111111111111";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const key = (v: unknown) => typeof v === "string" ? v : typeof obj(v).pubkey === "string" ? obj(v).pubkey as string : "";
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
const amount = (v: unknown) => typeof v === "string" && /^\d{1,80}$/.test(v) ? BigInt(v) : null;
export function formatRaw(raw: string, decimals: number) {
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  if (!decimals) return (negative ? "-" : "") + digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return (negative ? "-" : "") + digits.slice(0, -decimals) + (fraction ? "." + fraction : "");
}

export type TokenBalanceChange = { mint: string; decimals: number; beforeRaw: string; afterRaw: string; changeRaw: string };
export type TokenAccountChange = TokenBalanceChange & { account: string; accountIndex: number };
export type ObservedTrade = {
  protocol: "pump.fun" | "PumpSwap";
  instruction: string;
  side: "buy" | "sell";
  mint: string;
  tokenAccount: string;
  decimals: number;
  tokenAmountRaw: string;
  tokenAccountBeforeRaw: string;
  tokenAccountAfterRaw: string;
  quoteMint: string;
  attribution: "isolated_swap_sol_cashflow" | "unattributed";
  quoteFlowLamports: string | null;
  networkFeePaidLamports: string | null;
  excludedReasons: string[];
};
export type MatchedRoundTrip = {
  scope: "sampled_token_account_round_trip";
  mint: string;
  tokenAccount: string;
  netSolCashflowLamports: string;
  networkFeesLamports: string;
  holdingSeconds: number | null;
  buys: number;
  sells: number;
  sources: { signature: string; url: string }[];
  note: string;
};
export type WalletTransactionAnalysis = {
  version: 1;
  summary: string;
  wallet: string;
  signature: string;
  sourceUrl: string;
  blockTime: number | null;
  kind: "pump_trade" | "balance_change";
  balanceScope: "wallet_accounts_present_in_this_transaction";
  tokenBalanceCoverageComplete: boolean;
  native: { changeLamports: string | null; transactionFeeLamports: string | null; feePaidByWalletLamports: string | null; changeExcludingNetworkFeeLamports: string | null };
  wrappedSolChangeRaw: string | null;
  tokens: TokenBalanceChange[];
  tokenAccounts: TokenAccountChange[];
  trade: ObservedTrade | null;
  matchedRoundTrips: MatchedRoundTrip[];
  note: string;
};
export type WalletSample = { signature: string; transaction: unknown };

type SwapSpec = { name: string; side: "buy" | "sell"; user: number; mint: number; baseAccount: number; quoteMint?: number };
const legacy = (name: string, side: "buy" | "sell"): SwapSpec => ({ name, side, user: 6, mint: 2, baseAccount: 5 });
const v2 = (name: string, side: "buy" | "sell"): SwapSpec => ({ name, side, user: 13, mint: 1, baseAccount: 14, quoteMint: 2 });
const amm = (name: string, side: "buy" | "sell"): SwapSpec => ({ name, side, user: 1, mint: 3, baseAccount: 5, quoteMint: 4 });
const pumpInstructions: Record<string, SwapSpec> = {
  "102,6,61,18,1,218,235,234": legacy("buy", "buy"),
  "56,252,116,8,158,223,205,95": legacy("buy_exact_sol_in", "buy"),
  "51,230,133,164,1,127,131,173": legacy("sell", "sell"),
  "184,23,238,97,103,197,211,61": v2("buy_v2", "buy"),
  "194,171,28,70,104,77,91,47": v2("buy_exact_quote_in_v2", "buy"),
  "93,246,130,60,231,233,64,178": v2("sell_v2", "sell"),
};
const ammInstructions: Record<string, SwapSpec> = {
  "102,6,61,18,1,218,235,234": amm("buy", "buy"),
  "198,46,21,82,180,217,232,112": amm("buy_exact_quote_in", "buy"),
  "51,230,133,164,1,127,131,173": amm("sell", "sell"),
};
function swap(ix: Obj) {
  if (ix.programId !== PUMP_PROGRAM && ix.programId !== PUMP_SWAP_PROGRAM) return null;
  if (typeof ix.data !== "string") return null;
  try {
    const bytes = bs58.decode(ix.data);
    if (bytes.length < 24) return null; // Each supported instruction has at least two u64 arguments.
    const spec = (ix.programId === PUMP_PROGRAM ? pumpInstructions : ammInstructions)[Array.from(bytes.slice(0, 8)).join(",")];
    return spec ? { spec, accounts: arr(ix.accounts).map(key), ix } : null;
  } catch { return null; }
}

/** Parses public jsonParsed RPC data. Balance differences alone never establish a trade. */
export function analyzeWalletTransaction(input: unknown, wallet: string, signature: string): WalletTransactionAnalysis | null {
  const tx = obj(input), meta = obj(tx.meta), message = obj(obj(tx.transaction).message);
  if (!input || !tx.meta || meta.err) return null;
  const rawKeys = arr(message.accountKeys), keys = rawKeys.map(key), walletIndex = keys.indexOf(wallet);
  if (walletIndex < 0) return null;
  const pre = arr(meta.preBalances), post = arr(meta.postBalances);
  const before = integer(pre[walletIndex]), after = integer(post[walletIndex]), fee = integer(meta.fee);
  const delta = before !== null && after !== null ? after - before : null;
  const feePaid = walletIndex === 0 ? fee : BigInt(0);
  const withoutFee = delta !== null && feePaid !== null ? delta + feePaid : null;
  const preTokens = arr(meta.preTokenBalances), postTokens = arr(meta.postTokenBalances);
  const indexes = new Set([...preTokens, ...postTokens].map((v) => obj(v).accountIndex));
  const tokenAccounts: TokenAccountChange[] = [];
  let complete = Array.isArray(meta.preTokenBalances) && Array.isArray(meta.postTokenBalances);
  for (const index of indexes) {
    if (!Number.isInteger(index) || typeof index !== "number" || index < 0 || !keys[index]) { complete = false; continue; }
    const a = preTokens.find((v) => obj(v).accountIndex === index), b = postTokens.find((v) => obj(v).accountIndex === index);
    const pa = obj(a), pb = obj(b);
    if ((a && typeof pa.owner !== "string") || (b && typeof pb.owner !== "string")) complete = false;
    if (pa.owner !== wallet && pb.owner !== wallet) continue;
    const mint = String(pa.mint || pb.mint || ""), da = obj(pa.uiTokenAmount), db = obj(pb.uiTokenAmount);
    const decimals = a ? da.decimals : db.decimals;
    const av = a ? amount(da.amount) : integer(pre[index]) === BigInt(0) ? BigInt(0) : null;
    const bv = b ? amount(db.amount) : integer(post[index]) === BigInt(0) ? BigInt(0) : null;
    if ((a && pa.owner !== wallet) || (b && pb.owner !== wallet) ||
      (a && b && (pa.mint !== pb.mint || da.decimals !== db.decimals)) || !mint ||
      typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 18 || av === null || bv === null) {
      complete = false; continue;
    }
    tokenAccounts.push({ account: keys[index], accountIndex: index, mint, decimals, beforeRaw: av.toString(), afterRaw: bv.toString(), changeRaw: (bv - av).toString() });
  }
  const totals = new Map<string, TokenBalanceChange>();
  for (const account of tokenAccounts) {
    const previous = totals.get(account.mint);
    if (previous && previous.decimals !== account.decimals) { complete = false; continue; }
    totals.set(account.mint, { mint: account.mint, decimals: account.decimals,
      beforeRaw: (BigInt(previous?.beforeRaw || "0") + BigInt(account.beforeRaw)).toString(),
      afterRaw: (BigInt(previous?.afterRaw || "0") + BigInt(account.afterRaw)).toString(),
      changeRaw: (BigInt(previous?.changeRaw || "0") + BigInt(account.changeRaw)).toString() });
  }
  const top = arr(message.instructions).map(obj);
  const inner = arr(meta.innerInstructions).flatMap((v) => arr(obj(v).instructions)).map(obj);
  const allSwaps = [...top, ...inner].map(swap).filter((v) => v !== null);
  const walletSwaps = allSwaps.filter((v) => v.accounts[v.spec.user] === wallet);
  const owned = new Map(tokenAccounts.map((account) => [account.account, account]));
  const isSigner = obj(rawKeys[walletIndex]).signer === true ||
    (typeof rawKeys[walletIndex] === "string" && walletIndex < Number(obj(message.header).numRequiredSignatures || 0));
  let trade: ObservedTrade | null = null;
  if (walletSwaps.length === 1 && isSigner) {
    const hit = walletSwaps[0], base = owned.get(hit.accounts[hit.spec.baseAccount]);
    const baseDelta = base ? BigInt(base.changeRaw) : BigInt(0);
    if (base && base.mint === hit.accounts[hit.spec.mint] && (hit.spec.side === "buy" ? baseDelta > 0 : baseDelta < 0)) {
      const quoteMint = hit.spec.quoteMint === undefined ? WSOL_MINT : hit.accounts[hit.spec.quoteMint];
      const reasons: string[] = [];
      const setupOnly = (ix: Obj) => {
        if (ix === hit.ix || ix.programId === COMPUTE) return true;
        const parsed = obj(ix.parsed), info = obj(parsed.info), target = owned.get(String(info.account || info.destination || info.newAccount || ""));
        if (ix.programId === ATA) {
          const accounts = arr(ix.accounts).map(key);
          return (accounts[0] === wallet && accounts[2] === wallet && owned.has(accounts[1])) ||
            (info.source === wallet && info.wallet === wallet && owned.has(String(info.account)));
        }
        if (ix.programId === SYSTEM) {
          if (parsed.type === "transfer") return info.source === wallet && target?.mint === WSOL_MINT;
          return parsed.type === "createAccount" && info.source === wallet && Boolean(target) && [TOKEN, TOKEN_2022].includes(String(info.owner));
        }
        if (ix.programId === TOKEN || ix.programId === TOKEN_2022) {
          if (parsed.type === "syncNative") return target?.mint === WSOL_MINT;
          if (parsed.type === "closeAccount") return Boolean(target) && info.destination === wallet;
          return ["initializeAccount", "initializeAccount2", "initializeAccount3"].includes(String(parsed.type)) && Boolean(target) && info.owner === wallet;
        }
        return false;
      };
      if (!top.includes(hit.ix)) reasons.push("Pump swap is nested inside another program; transaction cashflow cannot be isolated.");
      if (allSwaps.length !== 1) reasons.push("Multiple swap instructions share this transaction.");
      if (!top.every(setupOnly)) reasons.push("Other transaction instructions may affect cashflow.");
      if (!complete) reasons.push("Token account ownership or balance metadata is incomplete.");
      if (quoteMint !== WSOL_MINT) reasons.push("Only SOL/WSOL quote cashflow is attributed in this analysis.");
      if (tokenAccounts.some((a) => a.changeRaw !== "0" && a.mint !== base.mint && a.mint !== WSOL_MINT)) reasons.push("Other token balances changed in the same transaction.");
      let tokenAccountLamports = BigInt(0);
      for (let i = 0; i < keys.length; i++) {
        const a = integer(pre[i]), b = integer(post[i]);
        if (a === null || b === null) { reasons.push("Exact account lamport balances are unavailable."); break; }
        if (owned.has(keys[i])) tokenAccountLamports += b - a;
        else if (i !== walletIndex && ((a === BigInt(0) && b > BigInt(0)) || (a > BigInt(0) && b === BigInt(0)))) {
          reasons.push("A non-token account was created or closed; rent or other flows are unresolved."); break;
        }
      }
      // Owned token-account lamports neutralize creation/closure rent and include native WSOL backing.
      // Never add WSOL token amounts again: they would double-count the same SOL.
      const quoteFlow = withoutFee === null ? null : withoutFee + tokenAccountLamports;
      if (quoteFlow === null || feePaid === null) reasons.push("The wallet's network-fee-adjusted SOL change is unavailable.");
      if (quoteFlow !== null && (hit.spec.side === "buy" ? quoteFlow >= 0 : quoteFlow <= 0)) reasons.push("Quote balance direction does not match the recognized swap.");
      trade = {
        protocol: hit.ix.programId === PUMP_PROGRAM ? "pump.fun" : "PumpSwap", instruction: hit.spec.name, side: hit.spec.side,
        mint: base.mint, tokenAccount: base.account, decimals: base.decimals,
        tokenAmountRaw: (baseDelta < 0 ? -baseDelta : baseDelta).toString(), tokenAccountBeforeRaw: base.beforeRaw, tokenAccountAfterRaw: base.afterRaw,
        quoteMint, attribution: reasons.length ? "unattributed" : "isolated_swap_sol_cashflow",
        quoteFlowLamports: reasons.length ? null : quoteFlow!.toString(), networkFeePaidLamports: feePaid?.toString() ?? null,
        excludedReasons: [...new Set(reasons)],
      };
    }
  }
  const tokens = [...totals.values()].filter((token) => token.changeRaw !== "0");
  const summary = trade
    ? `Observed ${trade.protocol} ${trade.side}: ${formatRaw(trade.tokenAmountRaw, trade.decimals)} tokens of ${trade.mint}. ${trade.quoteFlowLamports === null ? "SOL cashflow is not isolated; no return is calculated." : "Isolated SOL/WSOL cashflow " + formatRaw(trade.quoteFlowLamports, 9) + " SOL before this transaction's network fee."}`
    : `Observed balance change${walletSwaps.length ? " with Pump instructions" : ""}; no single supported wallet swap is established. SOL change ${delta === null ? "unavailable" : formatRaw(delta.toString(), 9)}; ${tokens.length} token mint balance(s) changed. Transfers are not automatically trades.`;
  return {
    version: 1, summary, wallet, signature, sourceUrl: "https://solscan.io/tx/" + signature,
    blockTime: typeof tx.blockTime === "number" && Number.isFinite(tx.blockTime) ? tx.blockTime : null,
    kind: trade ? "pump_trade" : "balance_change", balanceScope: "wallet_accounts_present_in_this_transaction", tokenBalanceCoverageComplete: complete,
    native: { changeLamports: delta?.toString() ?? null, transactionFeeLamports: fee?.toString() ?? null, feePaidByWalletLamports: feePaid?.toString() ?? null, changeExcludingNetworkFeeLamports: withoutFee?.toString() ?? null },
    wrappedSolChangeRaw: totals.get(WSOL_MINT)?.changeRaw ?? (complete ? "0" : null), tokens, tokenAccounts, trade, matchedRoundTrips: [],
    note: "Limited public transaction sample. Cashflow is not verified wallet PNL. Other holdings, earlier cost basis, off-chain costs and motives are unknown; profit causation cannot be inferred.",
  };
}

/** Input is RPC signature order (newest first). Matching never crosses this sample or missing transactions. */
export function analyzeWalletSample(samples: WalletSample[], wallet: string) {
  const observations = samples.map((sample) => analyzeWalletTransaction(sample.transaction, wallet, sample.signature));
  type Position = { balance: bigint; cashflow: bigint; fees: bigint; start: number | null; buys: number; sells: number; sources: { signature: string; url: string }[] };
  const positions = new Map<string, Position>();
  const roundTrips: MatchedRoundTrip[] = [];
  for (const observation of [...observations].reverse()) {
    if (!observation || !observation.tokenBalanceCoverageComplete) { positions.clear(); continue; }
    const trade = observation.trade;
    for (const account of observation.tokenAccounts) {
      if (account.changeRaw !== "0" && (!trade || trade.tokenAccount !== account.account || trade.quoteFlowLamports === null)) positions.delete(account.account);
    }
    if (!trade || trade.quoteFlowLamports === null || trade.networkFeePaidLamports === null) continue;
    let position = positions.get(trade.tokenAccount);
    const before = BigInt(trade.tokenAccountBeforeRaw), after = BigInt(trade.tokenAccountAfterRaw);
    if (position && position.balance !== before) { positions.delete(trade.tokenAccount); position = undefined; }
    if (!position && trade.side === "buy" && before === BigInt(0)) {
      position = { balance: BigInt(0), cashflow: BigInt(0), fees: BigInt(0), start: observation.blockTime, buys: 0, sells: 0, sources: [] };
      positions.set(trade.tokenAccount, position);
    }
    if (!position) continue;
    position.balance = after;
    position.cashflow += BigInt(trade.quoteFlowLamports) - BigInt(trade.networkFeePaidLamports);
    position.fees += BigInt(trade.networkFeePaidLamports);
    position[trade.side === "buy" ? "buys" : "sells"]++;
    position.sources.push({ signature: observation.signature, url: observation.sourceUrl });
    if (trade.side === "sell" && after === BigInt(0)) {
      const match: MatchedRoundTrip = {
        scope: "sampled_token_account_round_trip", mint: trade.mint, tokenAccount: trade.tokenAccount,
        netSolCashflowLamports: position.cashflow.toString(), networkFeesLamports: position.fees.toString(),
        holdingSeconds: position.start !== null && observation.blockTime !== null && observation.blockTime >= position.start ? observation.blockTime - position.start : null,
        buys: position.buys, sells: position.sells, sources: position.sources,
        note: "Only matching buys and sells of this token account inside the sampled wallet transactions; network fees on those swaps included, token-account rent neutralized. Activity that omits the wallet address may be absent. Not total wallet PNL or proof of strategy/motive.",
      };
      observation.matchedRoundTrips.push(match);
      observation.summary += ` Matched sampled token-account round trip: ${formatRaw(match.netSolCashflowLamports, 9)} SOL net cashflow${match.holdingSeconds === null ? "" : ", " + match.holdingSeconds + "s between entry and exit"}; not total wallet PNL.`;
      roundTrips.push(match);
      positions.delete(trade.tokenAccount);
    }
  }
  return { observations: observations.filter((v): v is WalletTransactionAnalysis => v !== null), roundTrips, sampleSize: samples.length, unavailableTransactions: observations.filter((v) => v === null).length };
}
