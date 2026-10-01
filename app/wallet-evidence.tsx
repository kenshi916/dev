import type { WalletTransactionAnalysis } from "./server/wallet-analysis";

function sol(value: string | null) {
  if (typeof value !== "string" || !/^-?\d{1,80}$/.test(value))
    return "Unattributed";
  const raw = BigInt(value),
    negative = raw < BigInt(0),
    absolute = negative ? -raw : raw;
  return (
    (negative ? "−" : "+") +
    (absolute / BigInt(1000000000)).toString() +
    "." +
    (absolute % BigInt(1000000000))
      .toString()
      .padStart(9, "0")
      .replace(/0+$/, "")
      .padEnd(1, "0") +
    " SOL"
  );
}

export default function WalletEvidence({
  analysis,
}: {
  analysis?: WalletTransactionAnalysis;
}) {
  if (!analysis || analysis.version !== 1) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row wrap tiny">
        <span className="badge">
          Wallet SOL change: {sol(analysis.native.changeLamports)}
        </span>
        {analysis.trade && (
          <span className="badge">
            {analysis.trade.protocol} · {analysis.trade.side.toUpperCase()}
          </span>
        )}
      </div>
      {analysis.matchedRoundTrips.map((round, index) => (
        <div className="note" key={round.mint + index}>
          <b>Matched buy / sell result: {sol(round.netSolCashflowLamports)}</b>
          <p className="tiny">
            {round.buys} buys · {round.sells} sells
            {round.holdingSeconds !== null
              ? " · " + Math.round(round.holdingSeconds / 60) + " minutes held"
              : ""}
          </p>
          <p className="tiny muted">{round.note}</p>
          <div className="row wrap tiny">
            {round.sources.map((source, i) => (
              <a
                key={source.signature}
                href={"https://solscan.io/tx/" + source.signature}
                target="_blank"
                rel="noreferrer"
              >
                Trade {i + 1} ↗
              </a>
            ))}
          </div>
        </div>
      ))}
      <details className="tiny muted" style={{ marginTop: 12 }}>
        <summary>What this observation can explain</summary>
        <p>{analysis.note}</p>
        {analysis.trade?.excludedReasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
      </details>
    </div>
  );
}
