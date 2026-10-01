import { AppError, db, id, now, one, rows, setting, textValue } from "./core";

export const FRESH_SIGNAL_MS = 6 * 60 * 60 * 1000;
const STUDY_WALLET = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export async function freshAgentSignals(owner: string, agentId: string) {
  const used: string[] = await setting(owner, "agent_sources_" + agentId, []);
  const signals = await rows(
    "SELECT id,kind,source,text,url,created_at FROM signals WHERE owner=? AND (kind='tweet' OR (kind='wallet' AND source=?)) ORDER BY created_at DESC LIMIT 100", owner, STUDY_WALLET,
  );
  const current = Date.now();
  return signals.filter((signal) => {
    const at = Date.parse(signal.created_at);
    if (!(Number.isFinite(at) && at <= current && current - at <= FRESH_SIGNAL_MS && !used.includes(signal.id))) return false;
    if (signal.kind === "tweet") return /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(signal.url);
    try {
      const observation = JSON.parse(signal.text);
      const occurred = typeof observation.blockTime === "number" ? observation.blockTime * 1000 : NaN;
      if (!Number.isFinite(occurred) || occurred > current || current - occurred > FRESH_SIGNAL_MS) return false;
      return observation.observation === "launch" && observation.launchingUser === STUDY_WALLET && observation.wallet === STUDY_WALLET && /^https:\/\/solscan\.io\/tx\//.test(signal.url);
    } catch { return false; }
  }).slice(0, 25);
}

export async function saveEvidenceProposal(owner: string, agentId: string, input: any, suppliedSignals: any[]) {
  const name = textValue(input.name, 32), symbol = textValue(input.symbol, 13).toUpperCase();
  const description = textValue(input.description, 2000), summary = textValue(input.summary, 1500);
  if (!/^[A-Z0-9]+$/.test(symbol)) throw new AppError("Symbol must be alphanumeric.");
  if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > 5)
    throw new AppError("Cite one to five fresh signal IDs from read_signals.");
  const fresh = await freshAgentSignals(owner, agentId);
  const sources = [...new Set(input.sourceIds)].map((sourceId) => {
    const source = fresh.find((signal) => signal.id === sourceId && suppliedSignals.some((s) => s.id === sourceId));
    if (!source) throw new AppError("A cited signal is stale, already used, or was not read in this run. Skip this launch.");
    return source;
  });
  const active = await one("SELECT status FROM agents WHERE id=? AND owner=?", agentId, owner);
  if (active?.status !== "running") throw new AppError("The agent was stopped.");
  const previous = await rows("SELECT name,symbol FROM drafts WHERE owner=?", owner);
  if (previous.some((draft) => normalize(draft.name) === normalize(name) || normalize(draft.symbol) === normalize(symbol)))
    throw new AppError("This name or ticker already exists in your workspace. Skip recycled concepts.");
  const used: string[] = await setting(owner, "agent_sources_" + agentId, []);
  const nextUsed = [...new Set([...used, ...sources.map((s) => s.id)])].slice(-500);
  const draftId = id();
  const rationale = summary + "\n\nSources: " + sources.map((s) => s.url).join(" · ");
  try { await db().batch([
    db().prepare("INSERT INTO settings(owner,key,value) VALUES (?,?,?)")
      .bind(owner, "coin_name_" + normalize(name), JSON.stringify(draftId)),
    db().prepare("INSERT INTO settings(owner,key,value) VALUES (?,?,?)")
      .bind(owner, "coin_symbol_" + normalize(symbol), JSON.stringify(draftId)),
    db().prepare("INSERT INTO drafts (id,owner,agent_id,name,symbol,description,rationale,status,created_at) VALUES (?,?,?,?,?,?,?,'draft',?)")
      .bind(draftId, owner, agentId, name, symbol, description, rationale, now()),
    db().prepare("INSERT INTO settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value")
      .bind(owner, "agent_sources_" + agentId, JSON.stringify(nextUsed)),
    db().prepare("INSERT INTO settings(owner,key,value) VALUES (?,?,?)")
      .bind(owner, "launch_thesis_" + draftId, JSON.stringify({ summary, sources: sources.map(s => ({ kind: s.kind, author: s.source, text: s.kind === "tweet" ? s.text.slice(0, 280) : "Verified reference-wallet deployment", url: s.url })) })),
  ]); } catch (error) {
    if (await setting(owner, "coin_name_" + normalize(name)) || await setting(owner, "coin_symbol_" + normalize(symbol)))
      throw new AppError("Another agent already claimed this name or ticker. Skip recycled concepts.", 409);
    throw error;
  }
  return { id: draftId, name, symbol, summary };
}
