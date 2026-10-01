import { rows } from "./core";
import { agentAvatarId } from "../agent-avatars";
import { coinEarnings } from "./coin-accounting";
import { publicLaunchDecisions } from "../launch-decisions";

const parse = (value: string | null) => { try { return JSON.parse(value || "null"); } catch { return null; } };
function coinData(d: any) {
  const launch = parse(d.accounting);
  const receipts = (parse(d.receipts) || []).map(parse).filter(Boolean);
  const image = launch?.imageUrl || d.image_url;
  return { name: launch?.name || d.name, symbol: launch?.symbol || d.symbol, mint: d.mint, signature: d.signature,
    image: typeof image === "string" && /^https:\/\/ipfs\.io\/ipfs\/[a-zA-Z0-9]+$/.test(image) ? image : null,
    earnings: coinEarnings(launch, receipts) };
}

function publicThesis(raw: string | null, launch: any) {
  try {
    const value = JSON.parse(raw || "null");
    if (typeof value?.summary !== "string" || !Array.isArray(value.sources)) return null;
    // A verified debit is recorded only after the trusted RPC's exact serialized
    // message matches Dev's prepared transaction. A parsed create/mint match
    // alone does not prove the pair and fee-mode flags were unchanged.
    const exactLaunch = launch?.verification === "server-rpc" && Number.isSafeInteger(launch.launchDebitLamports) && launch.launchDebitLamports >= 0;
    return { summary: value.summary.slice(0, 1500), decisions: exactLaunch ? publicLaunchDecisions(value.decisions, launch.creator) : null, sources: value.sources.slice(0, 5).flatMap((s: any) => {
      if (typeof s.url !== "string" || !/^https:\/\/(?:(?:www\.)?(?:x\.com|twitter\.com)\/|solscan\.io\/tx\/)/.test(s.url)) return [];
      return [{ kind: s.kind === "tweet" ? "tweet" : "wallet", author: String(s.author || "").slice(0, 100), text: String(s.text || "").slice(0, 280), url: s.url }];
    }) };
  } catch { return null; }
}

export async function publicActivity(kind?: string) {
  const [agents, launches] = await Promise.all([
    rows("SELECT a.id,a.name,a.model,s.public_key,json_extract(p.value,'$.avatar') AS avatar,json_extract(p.value,'$.createdAt') AS created_at FROM agents a JOIN sessions s ON s.agent_id=a.id AND s.owner=a.owner JOIN settings p ON p.owner=a.owner AND p.key='public_agent_'||a.id WHERE json_extract(p.value,'$.visible')=1 ORDER BY created_at DESC LIMIT 50"),
    rows("SELECT d.id,d.name,d.symbol,d.mint,d.signature,d.image_url,a.id AS agent_id,a.name AS agent_name,a.model,json_extract(p.value,'$.avatar') AS avatar,json_extract(c.value,'$.confirmedAt') AS created_at,c.value AS accounting,t.value AS thesis,(SELECT json_group_array(r.value) FROM settings r WHERE r.owner=d.owner AND r.key LIKE 'fee_receipt_%' AND json_extract(r.value,'$.draftId')=d.id) AS receipts FROM drafts d JOIN agents a ON a.id=d.agent_id AND a.owner=d.owner JOIN settings p ON p.owner=a.owner AND p.key='public_agent_'||a.id JOIN settings c ON c.owner=d.owner AND c.key='public_launch_'||d.id LEFT JOIN settings t ON t.owner=d.owner AND t.key='launch_thesis_'||d.id WHERE d.status='launched' AND d.mint IS NOT NULL AND d.signature IS NOT NULL AND json_extract(p.value,'$.visible')=1 ORDER BY created_at DESC LIMIT 50"),
  ]);
  return [...agents.map(a => ({ id: "agent:" + a.id, kind: "agent_created", agent: { id: a.id, name: a.name, model: a.model, avatar: agentAvatarId(a.avatar) }, wallet: a.public_key, createdAt: a.created_at })),
    ...launches.map(d => ({ id: "launch:" + d.id, kind: "coin_launched", agent: { id: d.agent_id, name: d.agent_name, model: d.model, avatar: agentAvatarId(d.avatar) }, coin: coinData(d), thesis: publicThesis(d.thesis, parse(d.accounting)), createdAt: d.created_at }))]
    .filter(item => !kind || item.kind === kind)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 50);
}
