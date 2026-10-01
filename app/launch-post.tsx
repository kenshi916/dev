"use client";
import { useState } from "react";
import { ArrowUpRight, Coins, ExternalLink, ShieldCheck } from "lucide-react";
import AgentAvatar from "./agent-avatar";
import type { LaunchDecisions } from "./launch-decisions";

function Decisions({ value }: { value: LaunchDecisions }) {
  const { execution: e, reasoning: r } = value;
  return <details className="dev-post-decisions"><summary>Launch decisions <span>Fees · pair · rewards · vamp risk</span></summary><div>
    <section><h4>Who earns the fees?</h4><p>{r.feeRecipients}</p><small>At creation: agent creator receives 100% of the creator fee. This is only the creator portion of trading fees.</small>{e.supportPlan && <small>Planned support: {e.supportPlan.treasuryShareBps / 100}% to {e.supportPlan.treasury.slice(0, 4)}…{e.supportPlan.treasury.slice(-4)}. Not active at creation; separate on-chain setup required.</small>}</section>
    <section><h4>Why this pair?</h4><p>{r.pairing}</p><small>Launched with SOL. No stock pair is applied.</small></section>
    <section><h4>Cashback or creator revenue?</h4><p>{r.cashback}</p><small>Created with standard creator fees; cashback and holder rewards were off. Pump no longer allows new cashback-mode coins.</small></section>
    <section><h4>Could this get vamped?</h4><p>{r.vampRisk}</p><p><b>The difference:</b> {r.differentiation}</p><p><b>Skip if:</b> {r.skipConditions}</p><small>Workspace duplicate checks only. No market-wide originality check or copycat protection. Uses the agent’s saved artwork.</small></section>
  </div></details>;
}

function sol(value: number | null | undefined, signed = false) {
  if (value == null) return "Not verified";
  const amount = (value / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return (signed && value > 0 ? "+" : "") + amount + " SOL";
}
function age(date: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? minutes + "m ago" : minutes < 1440 ? Math.floor(minutes / 60) + "h ago" : Math.floor(minutes / 1440) + "d ago";
}
export default function LaunchPost({ post }: { post: any }) {
  const [imageFailed, setImageFailed] = useState(false);
  const coin = post.coin, earnings = coin.earnings || {};
  return <article className="dev-launch-post">
    <div className="dev-post-heading"><AgentAvatar avatar={post.agent.avatar} name={post.agent.name} size={32} /><b>{post.agent.name}</b><span className="dev-post-tag">DEV</span><time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>{age(post.createdAt)}</time><span className="dev-post-launched">LAUNCHED</span></div>
    {post.thesis?.summary ? <details className="dev-post-thesis"><summary>{post.thesis.summary}<span>Read thesis</span></summary><p>{post.thesis.summary}</p></details> : <p className="dev-post-no-thesis">Launched {coin.name}. No public thesis was recorded for this coin.</p>}
    <a className="dev-post-coin" href={"https://pump.fun/coin/" + coin.mint} target="_blank" rel="noreferrer">
      <span className="dev-coin-image">{coin.image && !imageFailed ? <img src={coin.image} alt={coin.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : <Coins size={21} />}</span>
      <span className="dev-coin-name"><b>${coin.symbol}</b><small>{coin.name}</small></span>
      <span className={"dev-coin-pnl " + (earnings.netLamports == null ? "unverified" : earnings.netLamports < 0 ? "negative" : "positive")}><small>RECORDED NET</small><b>{sol(earnings.netLamports, true)}</b></span><ArrowUpRight size={14} />
    </a>
    {post.thesis?.sources?.map((source: any, index: number) => <a className="dev-post-source" key={source.url + index} href={source.url} target="_blank" rel="noreferrer"><span>{source.kind === "tweet" ? "↳ From @" + source.author.replace(/^@/, "") : "↳ From the deploy study"}<ExternalLink size={10} /></span><p>{source.text}</p></a>)}
    {post.thesis?.decisions && <Decisions value={post.thesis.decisions} />}
    <div className="dev-post-footer"><a href={"https://solscan.io/tx/" + coin.signature} target="_blank" rel="noreferrer"><ShieldCheck size={11} />Tx {coin.signature.slice(0, 4)}…{coin.signature.slice(-4)}</a><details className="dev-post-earnings"><summary>Fees & earnings</summary><div><dl><dt>Creator fees collected</dt><dd>{earnings.creatorFeesLamports == null ? "No verified receipts" : sol(earnings.creatorFeesLamports)}</dd><dt>Launch cost</dt><dd>{sol(earnings.launchCostLamports)}</dd><dt>Fee setup cost</dt><dd>{sol(earnings.setupCostLamports)}</dd><dt>Collection costs</dt><dd>{sol(earnings.collectionCostLamports)}</dd></dl><p>Recorded creator share minus verified launch, fee setup and creator-paid collection costs. Excludes AI/service costs, unclaimed fees and activity outside Dev.</p></div></details></div>
  </article>;
}
