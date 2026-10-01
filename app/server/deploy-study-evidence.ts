type ObjectValue = Record<string, unknown>;
type SavedSignal = { text: unknown; url?: unknown; created_at?: unknown };
const object = (v: unknown): ObjectValue => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const short = (v: unknown, length: number) => typeof v === "string" ? v.slice(0, length) : "";
const raw = (v: unknown) => typeof v === "string" && /^-?\d{1,40}$/.test(v) ? BigInt(v) : null;
const positive = (v: unknown) => { const value = raw(v); return value !== null && value >= BigInt(0) ? value : null; };
const time = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 8_640_000_000_000 ? v : null;
const stamp = (v: unknown) => { const seconds = time(v); return seconds === null ? null : new Date(seconds * 1000).toISOString(); };
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const txUrl = (signature: string) => "https://solscan.io/tx/" + encodeURIComponent(signature);
const sum = (values: bigint[]) => values.length ? values.reduce((total, item) => total + item, BigInt(0)).toString() : null;

type Observation = { data: ObjectValue; analysis: ObjectValue; signature: string; observedAt: string | null };
type RoundTrip = { mint: string; tokenAccount: string; net: bigint; fees: bigint; holdingSeconds: number | null; buys: number; sells: number; sources: { signature: string; url: string }[] };

/** Uses scanner-identified round trips only; saved windows are never stitched into new positions. */
function verifiedMatches(observations: Observation[]) {
  const bySignature = new Map(observations.map((item) => [item.signature, item]));
  const used = new Set<string>(), matches: RoundTrip[] = [];
  for (const item of observations) for (const candidate of array(item.analysis.matchedRoundTrips)) {
    const match = object(candidate), mint = short(match.mint, 64), tokenAccount = short(match.tokenAccount, 64);
    if (match.scope !== "sampled_token_account_round_trip" || !mint || !tokenAccount) continue;
    const sources = array(match.sources).map((source) => short(object(source).signature, 100));
    if (sources.length < 2 || new Set(sources).size !== sources.length || sources.some((signature) => !signature || used.has(tokenAccount + ":" + signature))) continue;
    let net = BigInt(0), fees = BigInt(0), before = BigInt(0), buys = 0, sells = 0, firstTime: number | null = null, lastTime: number | null = null;
    let valid = true;
    for (const [index, signature] of sources.entries()) {
      const source = bySignature.get(signature), analysis = source?.analysis, trade = object(analysis?.trade);
      const balanceBefore = positive(trade.tokenAccountBeforeRaw), balanceAfter = positive(trade.tokenAccountAfterRaw);
      const flow = raw(trade.quoteFlowLamports), fee = positive(trade.networkFeePaidLamports);
      const currentTime = time(analysis?.blockTime);
      if (!source || analysis?.tokenBalanceCoverageComplete !== true || trade.mint !== mint || trade.tokenAccount !== tokenAccount ||
        trade.attribution !== "isolated_swap_sol_cashflow" || balanceBefore !== before || balanceAfter === null || flow === null || fee === null ||
        !["buy", "sell"].includes(String(trade.side)) ||
        (trade.side === "buy" ? flow >= BigInt(0) || balanceAfter <= balanceBefore : flow <= BigInt(0) || balanceAfter >= balanceBefore) ||
        (lastTime !== null && currentTime !== null && currentTime < lastTime)) { valid = false; break; }
      if (!index) firstTime = currentTime;
      lastTime = currentTime;
      before = balanceAfter; net += flow - fee; fees += fee;
      if (trade.side === "buy") buys++; else sells++;
      if (balanceAfter === BigInt(0) && index !== sources.length - 1) { valid = false; break; }
    }
    if (!valid || before !== BigInt(0) || !buys || !sells || raw(match.netSolCashflowLamports) !== net || positive(match.networkFeesLamports) !== fees) continue;
    sources.forEach((signature) => used.add(tokenAccount + ":" + signature));
    matches.push({ mint, tokenAccount, net, fees, buys, sells,
      holdingSeconds: firstTime !== null && lastTime !== null && lastTime >= firstTime ? lastTime - firstTime : null,
      sources: sources.map((signature) => ({ signature, url: txUrl(signature) })) });
  }
  return matches;
}

export function deployStudyEvidence(saved: SavedSignal[], wallet: string) {
  const observations: Observation[] = [], seen = new Set<string>();
  for (const row of saved) {
    try {
      const data = object(JSON.parse(String(row.text))), analysis = object(data.analysis), signature = short(analysis.signature, 100);
      if (data.wallet !== wallet || analysis.wallet !== wallet || analysis.version !== 1 || !signature || seen.has(signature)) continue;
      seen.add(signature);
      observations.push({ data, analysis, signature, observedAt: typeof row.created_at === "string" ? row.created_at : null });
    } catch { /* Malformed saved rows do not become evidence. */ }
  }
  const matches = verifiedMatches(observations);
  const launches = observations.filter(({ data }) => data.observation === "launch" && data.launchingUser === wallet && typeof data.mint === "string");
  const distinctLaunches = launches.filter((item, index) => launches.findIndex((other) => other.data.mint === item.data.mint) === index);
  const deployMints = new Set(distinctLaunches.map((item) => item.data.mint));
  const deployments = distinctLaunches.sort((a, b) => (time(b.analysis.blockTime) ?? -1) - (time(a.analysis.blockTime) ?? -1)).slice(0, 32).map(({ data, analysis, signature, observedAt }) => {
    const mint = String(data.mint), coinMatches = matches.filter((match) => match.mint === mint);
    const trades = observations.map((item) => object(item.analysis.trade)).filter((trade) => trade.mint === mint);
    const nativeChange = raw(object(analysis.native).changeLamports);
    const image = short(data.image, 1200);
    return { name: short(data.name, 128), symbol: short(data.symbol, 52), mint, description: short(data.description, 600),
      image: /^https:\/\//.test(image) ? image : null, declaredCreator: short(data.declaredCreator, 64), observedAt,
      deployedAt: stamp(analysis.blockTime), transaction: txUrl(signature),
      launchWalletChangeLamports: nativeChange?.toString() ?? null,
      earnings: { matchedNetSolLamports: sum(coinMatches.map((match) => match.net)), matchedRoundTrips: coinMatches.length,
        holdingSecondsMedian: median(coinMatches.flatMap((match) => match.holdingSeconds === null ? [] : [match.holdingSeconds])), creatorFeesSolLamports: null },
      sampleBuyCount: trades.filter((trade) => trade.side === "buy").length,
      sampleSellCount: trades.filter((trade) => trade.side === "sell").length,
      roundTrips: coinMatches.map((match) => ({ netSolCashflowLamports: match.net.toString(), networkFeesLamports: match.fees.toString(),
        holdingSeconds: match.holdingSeconds, buys: match.buys, sells: match.sells, sources: match.sources })),
      observations: [
        "The tracked wallet signed the supported Pump create instruction as the launching user.",
        `${trades.filter((trade) => trade.side === "buy").length} buys and ${trades.filter((trade) => trade.side === "sell").length} sells of this mint appear in the saved sample.`,
        coinMatches.length ? `${coinMatches.length} complete sampled token-account round trip(s) have isolated SOL/WSOL cashflows.` : "No complete entry-to-exit cashflow is established for this coin in the saved sample.",
      ],
      unknowns: ["Creator-fee receipts and total coin profit are not established.", "Tweet-to-launch latency, competing launches and price history are not joined to this sample; success and its cause are unproven."],
    };
  });
  const deployedMatches = matches.filter((match) => deployMints.has(match.mint));
  const timedLaunches = distinctLaunches.map((item) => time(item.analysis.blockTime)).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const gaps = timedLaunches.slice(1).map((value, index) => value - timedLaunches[index]);
  const times = observations.map((item) => time(item.analysis.blockTime)).filter((value): value is number => value !== null);
  const sampleSources = deployments.slice(0, 3).map((item) => item.transaction);
  const lessons = [
    { title: "Study the launches that actually happened", evidence: `${distinctLaunches.length} distinct mints have a decoded create instruction signed by this wallet; ${observations.length} transaction observations are saved.`,
      limitation: "This is a partial history, not the wallet's complete set of launches.", sources: sampleSources },
    { title: "Measure timing before calling it speed", evidence: gaps.length ? `Median gap between sampled launches: ${median(gaps)} seconds across ${gaps.length} intervals.` : "At least two timestamped launches are needed to measure the observed cadence.",
      limitation: "A gap between launches does not measure response time to a tweet. Missing launches can make these gaps longer.", sources: sampleSources },
    { title: "Count losing exits as well as winners", evidence: `${deployedMatches.length} complete sampled round trips on the wallet's observed launches: ${deployedMatches.filter((match) => match.net > BigInt(0)).length} positive and ${deployedMatches.filter((match) => match.net < BigInt(0)).length} negative after network fees.`,
      limitation: "Matched trade cashflow excludes unmatched/open positions, creation costs, creator-fee revenue, and off-chain costs. It is not dev profit or lifetime wallet PNL.", sources: deployedMatches.slice(0, 3).flatMap((match) => match.sources.map((source) => source.url)) },
    { title: "Test the name, image and narrative hypothesis", evidence: "On-chain launch names and symbols are recorded; the scanner has no verified link from these launches to their triggering tweets.",
      limitation: "A fast deployment or a catchy name is a hypothesis, not a demonstrated reason a coin worked. Compare tweet timestamps, contemporaneous images, competitor launches, liquidity and failures before adopting a rule.", sources: sampleSources },
  ];
  return { deployments,
    summary: { deploymentCount: distinctLaunches.length, observedTransactionCount: observations.length, matchedRoundTrips: matches.length,
      matchedNetSolLamports: sum(matches.map((match) => match.net)), deployedCoinMatchedNetSolLamports: sum(deployedMatches.map((match) => match.net)),
      deployedCoinMatchedRoundTrips: deployedMatches.length, profitableRoundTrips: deployedMatches.filter((match) => match.net > BigInt(0)).length,
      losingRoundTrips: deployedMatches.filter((match) => match.net < BigInt(0)).length, lifetimePnlSolLamports: null, creatorFeesSolLamports: null,
      earningsScope: "Complete sampled token-account trade cashflow after network fees. Not creator-fee revenue, dev profit, or lifetime wallet PNL." },
    lessons, coverage: { savedRows: saved.length, oldestObservedAt: times.length ? stamp(Math.min(...times)) : null,
      newestObservedAt: times.length ? stamp(Math.max(...times)) : null, partial: true as const,
      displayedDeployments: deployments.length, missingTimestampCount: observations.filter((item) => time(item.analysis.blockTime) === null).length } };
}
