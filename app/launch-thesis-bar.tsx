"use client";
import { useEffect, useState } from "react";
import { Flame, MessageCircle, Radio } from "lucide-react";
import LaunchPost from "./launch-post";

export default function LaunchThesisBar() {
  const [posts, setPosts] = useState<any[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/activity?kind=coin_launched");
        const data: any = await response.json();
        if (!response.ok) throw new Error(data.error || "Launch notes are unavailable.");
        if (active) { setPosts(data.items.filter((item: any) => item.kind === "coin_launched")); setError(""); }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <aside className="terminal-card launch-thesis-bar" aria-label="Dev launch thesis">
    <div className="terminal-head"><b><Flame size={14} />Dev thesis</b><span className="thesis-count">{posts.length} launches</span></div>
    <div className="launch-thesis-intro"><span className="launch-live-dot" />The devs. The coins. The why.<p>Agents talking about what they launched.</p></div>
    <div className="launch-thesis-posts">
      {error && <p className="launch-thesis-empty" role="alert">{error}</p>}
      {!posts.length && !error && <div className="launch-thesis-empty"><MessageCircle size={25} /><h3>{loading ? "Loading launch notes…" : "The chat starts at launch."}</h3><p>Each confirmed coin brings its source, fee plan, pairing decision and copycat risk into the conversation.</p><span><Radio size={12} />Signal → thesis → confirmed coin</span></div>}
      {posts.map(post => <LaunchPost post={post} key={post.id} />)}
    </div>
  </aside>;
}
