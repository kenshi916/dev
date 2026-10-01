import { Keypair, PublicKey } from "@solana/web3.js";
import { AppError, change, db, encrypt, event, id, now, one, rows, rpc, setSetting, setting, textValue } from "./core";
import { aiAccessStatus } from "./ai-access";

// Disabled setup wallets have no running authorization window yet.
export const SETUP_EXPIRY = "1970-01-01T00:00:00.000Z";

export function walletLimits(input: any, allowEmptyRecipient = false) {
  const max = Number(input.maxSol ?? 0.05), per = Number(input.perLaunch ?? 0.015), count = Number(input.maxLaunches ?? 3);
  if (!Number.isFinite(max) || max < 0.001 || max > 1 ||
      !Number.isFinite(per) || per < 0.001 || per > max ||
      !Number.isInteger(count) || count < 1 || count > 10)
    throw new AppError("Use a total budget up to 1 SOL, a per-launch cap within that budget, and 1–10 launches.");
  let recipient = "";
  try {
    if (input.recipient || !allowEmptyRecipient) {
      const key = new PublicKey(input.recipient);
      if (!PublicKey.isOnCurve(key.toBytes())) throw new Error();
      recipient = key.toBase58();
    }
  } catch { throw new AppError("Enter your Solana return wallet address."); }
  return { max: Math.floor(max * 1e9), per: Math.floor(per * 1e9), count, recipient };
}

export async function walletInsert(owner: string, agentId: string, input: any) {
  const limits = walletLimits(input, true);
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const encrypted = await encrypt(Buffer.from(keypair.secretKey).toString("base64"), owner + ":session:" + agentId);
  const artwork = await setting(owner, "session_image");
  return { publicKey, statement: db().prepare(
    "INSERT INTO sessions (owner,agent_id,public_key,private_key,max_lamports,per_launch,max_launches,expires_at,image_url,recipient) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).bind(owner, agentId, publicKey, encrypted, limits.max, limits.per, limits.count, SETUP_EXPIRY, artwork || null, limits.recipient) };
}

export async function createAgentWallet(owner: string, input: any) {
  const agentId = textValue(input.creationId, 36, 36);
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) throw new AppError("Invalid creation request. Reopen the form and try again.");
  const name = textValue(input.name, 60), mission = textValue(input.mission, 3000, 12), model = textValue(input.model, 150);
  walletLimits(input, true);
  const existing = async () => {
    const agent = await one("SELECT * FROM agents WHERE id=? AND owner=?", agentId, owner);
    const session = await one("SELECT public_key,recipient,max_lamports,per_launch,max_launches FROM sessions WHERE agent_id=? AND owner=?", agentId, owner);
    if (!agent || !session) return null;
    if (agent.name !== name || agent.mission !== mission || agent.model !== model)
      throw new AppError("This creation request already belongs to another configuration.", 409);
    return { id: agentId, publicKey: session.public_key };
  };
  const reused = await existing();
  if (reused) return reused;
  if ((await rows("SELECT id FROM agents WHERE owner=?", owner)).length >= 20)
    throw new AppError("This workspace supports up to 20 devs.");
  const wallet = await walletInsert(owner, agentId, input);
  try {
    await db().batch([
      db().prepare("INSERT INTO agents (id,owner,name,mission,model,status,updated_at) VALUES (?,?,?,?,?,'ready',?)")
        .bind(agentId, owner, name, mission, model, now()),
      wallet.statement,
      db().prepare("INSERT INTO settings(owner,key,value) VALUES (?,?,?)")
        .bind(owner, "public_agent_" + agentId, JSON.stringify({ visible: true, createdAt: now() })),
      db().prepare("INSERT INTO events (id,owner,agent_id,kind,message,created_at) VALUES (?,?,?,'created',?,?)")
        .bind(id(), owner, agentId, name + " and its dedicated wallet were created. Activation is off.", now()),
    ]);
  } catch (error) {
    const retried = await existing();
    if (retried) return retried;
    throw error;
  }
  return { id: agentId, publicKey: wallet.publicKey };
}

export async function configureAgentWallet(owner: string, agentId: string, input: any) {
  const limits = walletLimits(input);
  const result = await db().batch([
    db().prepare("INSERT INTO settings(owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value")
      .bind(owner, "wallet_auth_" + agentId, JSON.stringify(id())),
    db().prepare("UPDATE sessions SET recipient=?,max_lamports=?,per_launch=?,max_launches=? WHERE agent_id=? AND owner=? AND enabled=0 AND expires_at=? AND used_launches=0 AND used_lamports=0")
      .bind(limits.recipient, limits.max, limits.per, limits.count, agentId, owner, SETUP_EXPIRY),
  ]);
  if (!result[1].meta.changes) throw new AppError("Wallet settings are fixed after its first activation.", 409);
  await change("DELETE FROM settings WHERE owner=? AND key=?", owner, "wallet_readiness_" + agentId);
  return { configured: true };
}

export async function sessionReadiness(owner: string, agentId: string) {
  const s = await one("SELECT * FROM sessions WHERE agent_id=? AND owner=?", agentId, owner);
  if (!s) throw new AppError("Create this agent’s dedicated wallet first.", 404);
  const providers = new Set((await rows("SELECT provider FROM secrets WHERE owner=?", owner)).map((r) => r.provider));
  const ai = await aiAccessStatus(owner);
  const art = s.image_url || await setting(owner, "session_image");
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });
  add("AI connection", ai.available, ai.available ? "Model access configured; provider credits are billed separately." : "Connect OpenRouter or enable platform-funded access.");
  add("Solana connection", providers.has("rpc"), providers.has("rpc") ? "Mainnet RPC configured." : "Solana RPC setup is pending for this workspace.");
  add("Artwork publishing", providers.has("pinata"), providers.has("pinata") ? "Artwork publishing configured." : "Artwork publishing setup is pending for this workspace.");
  add("Coin artwork", Boolean(art), art ? "Default artwork ready." : "Upload default coin artwork below.");
  add("Return address", Boolean(s.recipient), s.recipient ? "Withdrawal address saved." : "Save a return address for unused SOL before activation.");
  const available = s.used_launches < s.max_launches && s.used_lamports < s.max_lamports;
  add("Launch allowance", available, available ? "Remaining launches and SOL allowance available." : "This wallet’s approved allowance is exhausted.");
  const validWindow = s.expires_at === SETUP_EXPIRY || s.expires_at > now();
  add("Authorization window", validWindow, validWindow ? "24-hour authorization starts on first activation." : "This wallet’s 24-hour authorization expired. It can still return funds.");
  let balanceLamports: number | null = null;
  if (providers.has("rpc")) {
    try {
      const response = await rpc(owner, "getBalance", [s.public_key, { commitment: "confirmed" }]);
      if (Number.isSafeInteger(response?.value) && response.value >= 0) balanceLamports = response.value;
    } catch { /* Unknown is not zero and cannot authorize spending. */ }
  }
  const requiredLamports = Math.min(s.per_launch, Math.max(0, s.max_lamports - s.used_lamports));
  add("Wallet funding", balanceLamports !== null && balanceLamports >= requiredLamports && requiredLamports > 0,
    balanceLamports === null ? "Balance not verified. Connect RPC and check again." :
    `${(balanceLamports / 1e9).toFixed(5)} SOL confirmed; ${(requiredLamports / 1e9).toFixed(5)} SOL needed for the next launch allowance.`);
  const result = { agentId, publicKey: s.public_key, balanceLamports, requiredLamports, checkedAt: now(), checks,
    canActivate: checks.every((c) => c.ok) };
  await setSetting(owner, "wallet_readiness_" + agentId, result);
  return result;
}

export async function toggleAgentWallet(owner: string, agentId: string, enabled: boolean) {
  if (typeof enabled !== "boolean") throw new AppError("Choose on or off.");
  // Register the user's command before slow readiness calls. A newer pause or
  // configuration command invalidates this activation in the final atomic write.
  const authorization = JSON.stringify(id());
  const command = await db().batch([
    db().prepare("INSERT INTO settings(owner,key,value) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM sessions WHERE agent_id=? AND owner=?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value")
      .bind(owner, "wallet_auth_" + agentId, authorization, agentId, owner),
    db().prepare("UPDATE sessions SET enabled=CASE WHEN ? THEN enabled ELSE 0 END WHERE agent_id=? AND owner=?")
      .bind(enabled ? 1 : 0, agentId, owner),
  ]);
  if (!command[1].meta.changes) throw new AppError("Create this agent’s dedicated wallet first.", 404);
  const s = await one("SELECT * FROM sessions WHERE agent_id=? AND owner=?", agentId, owner);
  if (!s) throw new AppError("Create this agent’s dedicated wallet first.", 404);
  if (!enabled) {
    await event(owner, agentId, "session", "Agent paused. No new automatic launches are authorized.");
    return { enabled: false };
  }
  const readiness = await sessionReadiness(owner, agentId);
  if (!readiness.canActivate) throw new AppError(readiness.checks.filter((c) => !c.ok).map((c) => c.detail).join(" "));
  const art = s.image_url || await setting(owner, "session_image");
  const changed = await change(
    "UPDATE sessions SET enabled=1,image_url=?,expires_at=CASE WHEN expires_at=? THEN ? ELSE expires_at END WHERE agent_id=? AND owner=? AND (expires_at=? OR expires_at>?) AND used_launches<max_launches AND used_lamports<max_lamports AND EXISTS (SELECT 1 FROM settings WHERE owner=? AND key=? AND value=?)",
    art, SETUP_EXPIRY, new Date(Date.now() + 86400000).toISOString(), agentId, owner, SETUP_EXPIRY, now(), owner, "wallet_auth_" + agentId, authorization,
  );
  if (!changed.meta.changes) throw new AppError("Activation was superseded, expired, or its allowance is exhausted.");
  await event(owner, agentId, "session", "Agent activated within its wallet allowance. New decisions run while Dev is open.");
  return { enabled: true };
}

export async function requireActiveWallet(owner: string, agentId: string) {
  const s = await one("SELECT enabled,expires_at,used_launches,max_launches,used_lamports,max_lamports FROM sessions WHERE agent_id=? AND owner=?", agentId, owner);
  if (!s?.enabled || s.expires_at <= now() || s.used_launches >= s.max_launches || s.used_lamports >= s.max_lamports)
    throw new AppError("Create, fund and activate this agent’s wallet before running it.", 409);
  return s;
}
