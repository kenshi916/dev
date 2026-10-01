"use client";
import { useState } from "react";
import { BookOpen, Coins, ExternalLink, RefreshCw } from "lucide-react";
import { BWA_REFERENCE_CASE as reference } from "./bwa-reference";
import BwaLive from "./bwa-live";

const wallet = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
function sol(value: string | null | undefined) {
  if (value == null) return "Not established";
  const amount = Number(value) / 1e9;
  return (amount > 0 ? "+" : "") + amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) + " SOL";
}
function StudyCoin({ coin }: { coin: any }) {
  const [failed, setFailed] = useState(false);
  return <article className="study-coin">
    <div className="study-coin-heading"><span className="dev-coin-image">{coin.image && !failed ? <img src={coin.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Coins size={20} />}</span><div><a href={"https://pump.fun/coin/" + coin.mint} target="_blank" rel="noreferrer"><b>{coin.name}</b> <span>${coin.symbol}</span></a><small>{coin.deployedAt ? new Date(coin.deployedAt).toLocaleString() : "Time not established"}</small></div><a href={coin.transaction} target="_blank" rel="noreferrer" aria-label={"Verify " + coin.name + " launch"}><ExternalLink size={14} /></a></div>
    <div className="study-coin-metrics"><div><small>MATCHED TRADE CASHFLOW</small><b className={coin.earnings?.matchedNetSolLamports == null ? "muted" : Number(coin.earnings.matchedNetSolLamports) < 0 ? "negative" : "positive"}>{sol(coin.earnings?.matchedNetSolLamports)}</b></div><div><small>SAMPLED TRADES</small><b>{coin.sampleBuyCount} buys · {coin.sampleSellCount} sells</b></div></div>
    <details><summary>Evidence & what we can learn</summary><ul>{coin.observations?.map((text: string) => <li key={text}>{text}</li>)}</ul><p>{coin.unknowns?.join(" ")}</p>{coin.roundTrips?.map((trip: any, index: number) => <p key={index}>{sol(trip.netSolCashflowLamports)} · {trip.holdingSeconds == null ? "Holding time unknown" : trip.holdingSeconds + "s held"} {trip.sources.map((s: any, i: number) => <a key={s.signature} href={s.url} target="_blank" rel="noreferrer">Tx {i + 1} </a>)}</p>)}</details>
  </article>;
}
export default function BwaStudy({ study, busy, disabled, refresh, saveRpc }: { study: any; busy: boolean; disabled?: boolean; refresh: () => Promise<unknown>; saveRpc: (url: string) => Promise<boolean> }) {
  const [expanded, setExpanded] = useState(false);
  const summary = study?.version === 2 ? study.summary : null;
  return <section className="bwa-study" aria-label="bwa deployment study">
    <div className="study-heading"><div><span className="eyebrow"><BookOpen size={12} /> LEARN FROM THE CHAIN</span><h3>bwa’s deploy study</h3><p>Real launches. Measured outcomes. A better question than “copy the winner.”</p></div><button className="button small" disabled={disabled} onClick={async () => { setExpanded(true); await refresh(); }}><RefreshCw size={13} className={busy ? "spin" : ""} />{busy ? "Scanning…" : "Study recent deploys"}</button></div>
    <div className="study-context"><a href={"https://solscan.io/account/" + wallet} target="_blank" rel="noreferrer">bwam…fSXa <ExternalLink size={11} /></a><span>{study?.checkedAt ? "Checked " + new Date(study.checkedAt).toLocaleString() : "No scan saved yet"}</span><span>Partial history</span></div>
    <BwaLive saveRpc={saveRpc} />
    {study?.refreshError && <p className="study-status" role="status">{study.refreshError}</p>}
    <div className="study-metrics"><div><small>VERIFIED DEPLOYS</small><strong>{summary?.deploymentCount ?? "—"}</strong><span>in saved observations</span></div><div><small>MATCHED LAUNCH-COIN TRADES</small><strong>{sol(summary?.deployedCoinMatchedNetSolLamports)}</strong><span>{summary?.deployedCoinMatchedRoundTrips ?? 0} complete sampled round trips</span></div><div><small>LIFETIME EARNINGS</small><strong>Not established</strong><span>Trading cashflow ≠ creator revenue</span></div></div>
    <article className="bwa-reference"><div className="bwa-reference-heading"><h4>A verified case: <a href={"https://pump.fun/coin/" + reference.mint} target="_blank" rel="noreferrer">{reference.name} · ${reference.symbol}</a></h4><span>Launched {new Date(reference.deployedAt).toLocaleDateString()}</span></div><div className="reference-result"><strong>{sol(String(reference.cashflowLamports))}</strong><span>Observed cashflow including fee setup · {reference.holdingSeconds}s to fully sell the observed position</span></div><p>{reference.observation} Separately, a creator-vault collection transferred <b>{sol(String(reference.aggregateCreatorReceiptLamports))}</b> across unspecified coins.</p><div className="reference-links">{reference.sources.map(source => <a key={source.label} href={source.url} target="_blank" rel="noreferrer">{({create: "Launch & buy", "fee-setup": "Fee setup", "sell-one": "First sell", "sell-two": "Final sell", "aggregate-fee-collection": "Creator receipt"} as Record<string, string>)[source.label]}</a>)}</div><p>{reference.limitation} Research checked {new Date(reference.checkedAt).toLocaleString()}.</p></article>
    <button className="study-expand" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Hide study" : "View deployments & lessons"}<span>{expanded ? "−" : "+"}</span></button>
    {expanded && <div className="study-body">{study?.deployments?.length ? <div className="study-coins">{study.deployments.map((coin: any) => <StudyCoin key={coin.mint} coin={coin} />)}</div> : <p className="study-empty">{busy ? "Checking signed Pump create instructions and complete trade cashflows…" : "No verified deployments in the saved sample yet. Scan recent transactions to build the study."}</p>}
      {!!study?.lessons?.length && <div className="study-lessons">{study.lessons.map((lesson: any) => <article key={lesson.title}><h4>{lesson.title}</h4><p>{lesson.evidence}</p><small>{lesson.limitation}</small></article>)}</div>}
      <p className="study-footnote">{summary?.earningsScope || "A bounded transaction sample can miss launches and trades. Unknown amounts stay unknown."} {study?.scope || "Manual scans inspect up to 80 recent transactions, with a two-minute cooldown."}</p>
    </div>}
  </section>;
}
