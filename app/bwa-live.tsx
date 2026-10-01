"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Radio, RefreshCw } from "lucide-react";

const amount = (v: string | null | undefined) => v == null ? "Unknown" : (Number(v) > 0 ? "+" : "") + (Number(v) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 }) + " SOL";
export default function BwaLive({ saveRpc }: { saveRpc: (url: string) => Promise<boolean> }) {
  const [feed, setFeed] = useState<any>(null), [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [rpcUrl, setRpcUrl] = useState(""), [saving, setSaving] = useState(false);
  const inFlight = useRef(false), alive = useRef(true);
  const load = useCallback(async (refresh = false) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const r = await fetch("/api/wallet-live", refresh ? { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" } : { cache: "no-store" });
      const value: any = await r.json();
      if (!r.ok) throw new Error(value.error || "Wallet activity is unavailable.");
      if (alive.current) { setFeed(value); setError(""); }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }, []);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    if (!enabled || !feed?.configured) return;
    void load(true);
    const tick = () => { if (!document.hidden) void load(true); };
    const timer = setInterval(tick, 10000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [enabled, feed?.configured, load]);
  const labels: Record<string, string> = { needs_rpc: "RPC connection needed", idle: "Ready to monitor", current: "History checked", catching_up: "Catching up", gap: "History gap", error: "Connection interrupted" };
  return <section className="bwa-live" aria-label="bwa current wallet activity"><div className="live-heading"><div><h4><Radio size={14} /> Current wallet activity</h4><p>Follow what bwa does next. Every action links to its transaction.</p></div><div className="row"><button className="button small" disabled={busy || !feed?.configured} onClick={() => load(true)} aria-label="Refresh current wallet activity"><RefreshCw size={13} /></button><button className={"button small " + (enabled ? "primary" : "")} disabled={!feed?.configured} onClick={() => setEnabled(!enabled)}>{enabled ? "Pause updates" : "Start updates"}</button></div></div>
    <div className="live-status"><span>{labels[feed?.status] || "Loading activity…"}</span><span>{enabled && feed?.configured ? "Auto-refresh · 10s" : "Auto-refresh off"}</span><span>{feed?.lastSuccess ? "History checked " + new Date(feed.lastSuccess).toLocaleTimeString() : "No successful live check"}</span>{!!feed?.pending && <span>{feed.pending} details pending</span>}{busy && <span>Checking…</span>}</div>
    {error && <p className="study-status" role="alert">{error}</p>}{feed?.error && <p className="study-status" role="status">{feed.error}</p>}{feed?.gap && <p className="study-status" role="status">{feed.gap}</p>}
    {feed && !feed.configured && <form className="live-rpc" onSubmit={async e => { e.preventDefault(); setSaving(true); try { if (await saveRpc(rpcUrl)) { setRpcUrl(""); await load(); setEnabled(true); } } finally { setSaving(false); } }}><label htmlFor="bwa-live-rpc">Connect a dedicated Solana mainnet RPC</label><div><input id="bwa-live-rpc" type="password" autoComplete="off" spellCheck={false} value={rpcUrl} onChange={e => setRpcUrl(e.target.value)} placeholder="Paste your HTTPS RPC endpoint" required /><button className="button small" disabled={saving || !rpcUrl}>{saving ? "Connecting…" : "Connect RPC"}</button></div><p>Saved encrypted in your workspace. This is also used by your agent wallets. Polling uses your provider’s request allowance; it does not launch or trade coins.</p></form>}
    <div className="live-transactions">{feed?.items?.length ? feed.items.map((item: any) => <article key={item.signature}><div className="live-transaction-head"><span className={"live-action " + item.status}>{item.action}</span><time title={item.occurredAt || "Unknown chain time"}>{item.occurredAt ? new Date(item.occurredAt).toLocaleString() : "Time unavailable"}</time></div>{item.mint && <a className="live-coin" href={"https://solscan.io/token/" + item.mint} target="_blank" rel="noreferrer">{item.name || item.mint.slice(0, 6) + "…" + item.mint.slice(-4)}{item.symbol ? " · $" + item.symbol : ""}<ExternalLink size={11} /></a>}<p>{item.explanation}</p><div className="live-transaction-foot"><span>Wallet SOL change: <b>{amount(item.nativeChangeLamports)}</b></span><a href={item.url} target="_blank" rel="noreferrer">Verify transaction <ExternalLink size={10} /></a></div>{item.caveat && <small>{item.caveat}</small>}</article>) : <p className="live-empty">{feed?.configured ? "Start updates to load recent activity and follow new transactions." : "Connect the RPC to begin. The dated reference case below remains available."}</p>}</div>
    <p className="live-scope">{feed?.scope || "Confirmed address activity. Decoded Pump trades, launches and native creator-fee collections get factual explanations; other actions stay unclassified."} The feed explains observed actions; price causes and private motives are not established.</p>
  </section>;
}
