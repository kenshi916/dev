import { rows } from "./core";

function publicThesis(raw: string | null) {
  try {
    const value = JSON.parse(raw || "null");
    if (typeof value?.summary !== "string" || !Array.isArray(value.sources)) return null;
    return { summary: value.summary.slice(0, 1500), sources: value.sources.slice(0, 5).flatMap((s: any) => {
      if (typeof s.url !== "string" || !/^https:\/\/(?:(?:www\.)?(?:x\.com|twitter\.com)\/|solscan\.io\/tx\/)/.test(s.url)) return [];
      return [{ kind: s.kind === "tweet" ? "tweet" : "wallet", author: String(s.author || "").slice(0, 100), text: String(s.text || "").slice(0, 280), url: s.url }];
    }) };
  } catch { return null; }
}

export async function publicActivity(kind?: string) {
  const [agents, launches] = await Promise.all([
    rows("SELECT a.id,a.name,a.model,s.public_key,json_extract(p.value,'$.createdAt') AS created_at FROM agents a JOIN sessions s ON s.agent_id=a.id AND s.owner=a.owner JOIN settings p ON p.owner=a.owner AND p.key='public_agent_'||a.id WHERE json_extract(p.value,'$.visible')=1 ORDER BY created_at DESC LIMIT 50"),
    rows("SELECT d.id,d.name,d.symbol,d.mint,d.signature,a.id AS agent_id,a.name AS agent_name,a.model,json_extract(c.value,'$.confirmedAt') AS created_at,t.value AS thesis FROM drafts d JOIN agents a ON a.id=d.agent_id AND a.owner=d.owner JOIN settings p ON p.owner=a.owner AND p.key='public_agent_'||a.id JOIN settings c ON c.owner=d.owner AND c.key='public_launch_'||d.id LEFT JOIN settings t ON t.owner=d.owner AND t.key='launch_thesis_'||d.id WHERE d.status='launched' AND d.mint IS NOT NULL AND d.signature IS NOT NULL AND json_extract(p.value,'$.visible')=1 ORDER BY created_at DESC LIMIT 50"),
  ]);
  return [...agents.map(a => ({ id: "agent:" + a.id, kind: "agent_created", agent: { id: a.id, name: a.name, model: a.model }, wallet: a.public_key, createdAt: a.created_at })),
    ...launches.map(d => ({ id: "launch:" + d.id, kind: "coin_launched", agent: { id: d.agent_id, name: d.agent_name, model: d.model }, coin: { name: d.name, symbol: d.symbol, mint: d.mint, signature: d.signature }, thesis: publicThesis(d.thesis), createdAt: d.created_at }))]
    .filter(item => !kind || item.kind === kind)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 50);
}
