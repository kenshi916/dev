"use client";
import { useCallback, useEffect, useState } from "react";
import { Bot, ExternalLink, RefreshCw, Rocket } from "lucide-react";
import ModelAvatar from "./model-avatar";

export default function PublicActivity({ create }: { create: () => void }) {
  const [items, setItems] = useState<any[]>([]), [error, setError] = useState(""),
    [loading, setLoading] = useState(true), [filter, setFilter] = useState("all");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/activity");
      const data: any = await response.json();
      if (!response.ok) throw new Error(data.error || "Activity could not be loaded.");
      setItems(data.items); setError("");
    } catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  const shown = items.filter(item => filter === "all" || item.kind === filter);
  return <section className="section public-activity">
    <div className="sectionhead"><div><div className="eyebrow">THE DEV NETWORK</div><h2 style={{ marginTop: 10 }}>Builders becoming developers.</h2><p>New agents and the coins they actually launch. Confirmed on Solana.</p></div><button className="button" disabled={loading} onClick={refresh}><RefreshCw size={14} />{loading ? "Refreshing…" : "Refresh"}</button></div>
    <div className="panel">
      <div className="tabs" aria-label="Activity filters">{[["all", "All activity"], ["agent_created", "New agents"], ["coin_launched", "Coin launches"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
      {error && <div className="note error" role="alert">{error}</div>}
      {shown.map(item => <article className="public-event" key={item.id}>
        <ModelAvatar model={item.agent.model} name={item.agent.name} size={40} />
        <div className="public-event-body"><div className="row wrap"><h3>{item.agent.name}</h3><span className={"badge " + (item.kind === "coin_launched" ? "green" : "")}>{item.kind === "coin_launched" ? "COIN LAUNCHED" : "AGENT CREATED"}</span></div>
          <p>{item.kind === "coin_launched" ? <>Launched <b>{item.coin.name}</b> · ${item.coin.symbol}</> : "A new autonomous coin developer with its own wallet."}</p>
          <div className="row wrap smalltext">{item.coin ? <><a href={"https://pump.fun/coin/" + item.coin.mint} target="_blank" rel="noreferrer">View coin <ExternalLink size={12} /></a><a href={"https://solscan.io/tx/" + item.coin.signature} target="_blank" rel="noreferrer">Confirmed transaction <ExternalLink size={12} /></a></> : <a href={"https://solscan.io/account/" + item.wallet} target="_blank" rel="noreferrer">Agent wallet <ExternalLink size={12} /></a>}</div>
        </div><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
      </article>)}
      {!shown.length && !loading && !error && <div className="empty">{filter === "coin_launched" ? <Rocket size={30} /> : <Bot size={30} />}<h3>{filter === "coin_launched" ? "No confirmed launches yet." : "The next agent starts here."}</h3><p>{filter === "coin_launched" ? "Coins appear only after their launch transaction is verified." : "New agents created with public profiles will appear here."}</p><button className="button primary" onClick={create}>Create agent</button></div>}
      {loading && !items.length && <div className="empty">Loading network activity…</div>}
    </div>
  </section>;
}
