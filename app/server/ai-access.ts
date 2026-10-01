// Server-only: this module depends on Cloudflare bindings and never belongs in a client component.
// Official contract: https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key
// One provider-enforced daily key per approved owner, not one key per request or agent.
import { env } from "cloudflare:workers";
import { AppError, change, decrypt, encrypt, one } from "./core";

const RECORD_KEY = "ai_sponsored_access_v1";
const API = "https://openrouter.ai/api/v1/keys";
const SPONSORED_CONTEXT = ":openrouter-sponsored:v1";
const ATTENTION = "Dev-sponsored AI needs administrator attention. Connect your own OpenRouter account to continue.";

type Config = {
  enabled: boolean;
  configured: boolean;
  managementKey: string;
  owners: Set<string>;
  dailyLimitUsd: number | null;
};
type AccessRecord = {
  version: 1;
  state: "pending" | "ready" | "attention";
  attempt: string;
  createdAt: string;
  dailyLimitUsd: number;
  hash?: string;
  sealedKey?: string;
};
export type AIAccessStatus = {
  available: boolean;
  source: "personal" | "sponsored" | null;
  dailyLimitUsd: number | null;
  message: string;
  personalConnected: boolean;
  sponsored: {
    enabled: boolean;
    configured: boolean;
    eligible: boolean;
    dailyLimitUsd: number | null;
    limitReset: "daily";
    resetTimezone: "UTC";
    provisioning: "not_started" | "pending" | "ready" | "needs_attention";
    funding: "not_verified";
  };
};

function config(): Config {
  const bindings = env as unknown as Record<string, unknown>;
  const read = (name: string) => typeof bindings[name] === "string" ? bindings[name].trim() : "";
  const rawLimit = read("DEV_SPONSORED_AI_DAILY_USD");
  const amount = Number(rawLimit);
  // An explicit cents-denominated cap is required; invalid settings never mean unlimited.
  const dailyLimitUsd = rawLimit && /^\d+(\.\d{1,2})?$/.test(rawLimit) &&
    Number.isFinite(amount) && amount >= 0.01 && amount <= 100 ? amount : null;
  const managementKey = read("OPENROUTER_MANAGEMENT_KEY");
  const owners = new Set(read("DEV_SPONSORED_AI_OWNERS").split(",").map((v) => v.trim()).filter(Boolean));
  const configured = Boolean(
    managementKey && !/[\r\n]/.test(managementKey) && dailyLimitUsd !== null &&
    owners.size > 0 && !owners.has("*") && read("CREDENTIAL_SECRET").length >= 32,
  );
  return { enabled: read("DEV_SPONSORED_AI_ENABLED") === "true", configured, managementKey, owners, dailyLimitUsd };
}

function validOwner(owner: string) {
  if (typeof owner !== "string" || !owner || owner !== owner.trim() || owner.length > 256)
    throw new AppError("Sign in to use AI access.", 401);
}
function eligible(c: Config, owner: string) {
  return c.enabled && c.configured && c.owners.has(owner);
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function record(value: string): AccessRecord | null {
  try {
    const r = object(JSON.parse(value));
    if (r.version !== 1 || !["pending", "ready", "attention"].includes(String(r.state)) ||
      typeof r.attempt !== "string" || typeof r.createdAt !== "string" ||
      typeof r.dailyLimitUsd !== "number" || !Number.isFinite(r.dailyLimitUsd) || r.dailyLimitUsd <= 0)
      return null;
    if (r.state === "ready" && (typeof r.hash !== "string" || !/^[a-f0-9]{64}$/i.test(r.hash) ||
      typeof r.sealedKey !== "string" || !r.sealedKey)) return null;
    return r as AccessRecord;
  } catch { return null; }
}
async function stored(owner: string): Promise<{ value: string } | null> {
  return one("SELECT value FROM settings WHERE owner=? AND key=?", owner, RECORD_KEY);
}

/** Safe to include in an authenticated response. This does not check, buy, or promise account credits. */
export async function aiAccessStatus(owner: string): Promise<AIAccessStatus> {
  validOwner(owner);
  const c = config();
  const personal = await one("SELECT 1 AS present FROM secrets WHERE owner=? AND provider=?", owner, "openrouter");
  const row = await stored(owner);
  const state = row ? record(row.value) : null;
  const sponsoredAvailable = eligible(c, owner) && (!row || state?.state === "ready");
  const dailyLimitUsd = eligible(c, owner) ? Math.min(c.dailyLimitUsd!, state?.dailyLimitUsd ?? c.dailyLimitUsd!) : null;
  return {
    available: Boolean(personal) || sponsoredAvailable,
    source: personal ? "personal" : sponsoredAvailable ? "sponsored" : null,
    dailyLimitUsd: personal ? null : dailyLimitUsd,
    message: personal ? "Your connected OpenRouter account pays for model usage."
      : sponsoredAvailable ? "Dev-sponsored AI is enabled for your account. The daily cap is not a funded balance; platform credits have not been verified."
      : eligible(c, owner) ? "Dev-sponsored AI setup needs administrator attention. You can connect your own OpenRouter account."
      : "Connect your own OpenRouter account. Dev-sponsored AI is not enabled for this account.",
    personalConnected: Boolean(personal),
    sponsored: {
      enabled: c.enabled,
      configured: c.configured,
      eligible: eligible(c, owner),
      dailyLimitUsd,
      limitReset: "daily",
      resetTimezone: "UTC",
      provisioning: !row ? "not_started" : !state || state.state === "attention" ? "needs_attention" : state.state,
      funding: "not_verified",
    },
  };
}

async function management(c: Config, path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(API + path, {
      ...init,
      headers: { Authorization: "Bearer " + c.managementKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      // Workers supports manual/follow; the !ok check rejects redirects without forwarding the key.
      redirect: "manual",
      cache: "no-store",
    });
  } catch { throw new AppError("Dev-sponsored AI could not be reached. Administrator review may be required.", 503); }
  // Never forward provider response text: a failed management response may contain sensitive data.
  if (!response.ok) throw new AppError("Dev-sponsored AI access could not be confirmed.", 503);
  try { return object(await response.json()); }
  catch { throw new AppError("Dev-sponsored AI returned an invalid access response.", 503); }
}

function verifyLimits(data: Record<string, unknown>, c: Config, expectedHash?: string) {
  if (typeof data.hash !== "string" || !/^[a-f0-9]{64}$/i.test(data.hash) ||
    (expectedHash && data.hash !== expectedHash) || data.disabled !== false ||
    data.limit_reset !== "daily" || data.include_byok_in_limit !== true ||
    typeof data.limit !== "number" || !Number.isFinite(data.limit) || data.limit <= 0 ||
    data.limit > c.dailyLimitUsd! || typeof data.limit_remaining !== "number" ||
    !Number.isFinite(data.limit_remaining)) throw new AppError(ATTENTION, 503);
  if (data.expires_at !== null && data.expires_at !== undefined &&
    (typeof data.expires_at !== "string" || !Number.isFinite(Date.parse(data.expires_at)) ||
      Date.parse(data.expires_at) <= Date.now())) throw new AppError(ATTENTION, 503);
  if (data.limit_remaining <= 0)
    throw new AppError("Your Dev-sponsored daily AI allowance is exhausted. It resets at midnight UTC; you can connect your own OpenRouter account.", 429);
}

async function existingAccess(owner: string, c: Config, raw: string) {
  const r = record(raw);
  if (!r || r.state === "attention") throw new AppError(ATTENTION, 503);
  if (r.state === "pending")
    throw new AppError("Dev-sponsored AI setup is pending. An interrupted setup requires administrator review; no duplicate key will be created.", 409);
  // A fresh check prevents using a disabled, uncapped, expired or over-budget key.
  const response = await management(c, "/" + r.hash);
  verifyLimits(object(response.data), c, r.hash);
  let apiKey: string;
  try { apiKey = await decrypt(r.sealedKey!, owner + SPONSORED_CONTEXT); }
  catch { throw new AppError(ATTENTION, 503); }
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new AppError(ATTENTION, 503);
  return { apiKey, source: "sponsored" as const };
}

/** Pass only the authenticated owner from userId(), never a client-supplied owner. Never serialize this return value. */
export async function openRouterAccess(owner: string): Promise<{ apiKey: string; source: "personal" | "sponsored" }> {
  validOwner(owner);
  const personal = await one("SELECT value FROM secrets WHERE owner=? AND provider=?", owner, "openrouter");
  if (personal) {
    // A malformed personal credential must not silently fall back to platform spending.
    let apiKey: string;
    try { apiKey = await decrypt(personal.value, owner + ":openrouter"); }
    catch { throw new AppError("Reconnect your OpenRouter account in Connections.", 503); }
    if (!apiKey || /[\r\n]/.test(apiKey)) throw new AppError("Reconnect your OpenRouter account in Connections.", 503);
    return { apiKey, source: "personal" };
  }
  const c = config();
  if (!eligible(c, owner))
    throw new AppError("Connect OpenRouter in Connections. Dev-sponsored AI is not enabled for this account.", 403);
  const existing = await stored(owner);
  if (existing) return existingAccess(owner, c, existing.value);

  // This durable unique row is the provisioning lock across isolates/processes.
  // It NEVER expires automatically: POST /keys has no documented idempotent retry or plaintext-key recovery.
  const pending: AccessRecord = { version: 1, state: "pending", attempt: crypto.randomUUID(), createdAt: new Date().toISOString(), dailyLimitUsd: c.dailyLimitUsd! };
  const pendingRaw = JSON.stringify(pending);
  const lock = await change("INSERT INTO settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO NOTHING", owner, RECORD_KEY, pendingRaw);
  if (lock.meta.changes !== 1) {
    const winner = await stored(owner);
    if (!winner) throw new AppError(ATTENTION, 503);
    return existingAccess(owner, c, winner.value);
  }
  let knownHash: string | undefined;
  try {
    // Test encryption BEFORE creating a write-once provider secret.
    await encrypt("credential-readiness-check", owner + SPONSORED_CONTEXT);
    const response = await management(c, "", {
      method: "POST",
      body: JSON.stringify({ name: "Dev sponsored " + pending.attempt, limit: c.dailyLimitUsd, limit_reset: "daily", include_byok_in_limit: true }),
    });
    const data = object(response.data);
    if (typeof data.hash === "string" && /^[a-f0-9]{64}$/i.test(data.hash)) knownHash = data.hash;
    verifyLimits(data, c);
    if (typeof response.key !== "string" || !response.key || /[\r\n]/.test(response.key)) throw new AppError(ATTENTION, 503);
    const ready: AccessRecord = { ...pending, state: "ready", hash: knownHash, sealedKey: await encrypt(response.key, owner + SPONSORED_CONTEXT) };
    const saved = await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify(ready), owner, RECORD_KEY, pendingRaw);
    if (saved.meta.changes !== 1) throw new AppError(ATTENTION, 503);
    return { apiKey: response.key, source: "sponsored" };
  } catch {
    // Unknown outcomes remain blocked, even after process restart. The operator must reconcile the
    // named attempt in OpenRouter and revoke any orphan before manually resetting this record.
    // CAS preserves a successfully committed ready record if a database response was lost.
    await change("UPDATE settings SET value=? WHERE owner=? AND key=? AND value=?", JSON.stringify({ ...pending, state: "attention", ...(knownHash ? { hash: knownHash } : {}) }), owner, RECORD_KEY, pendingRaw).catch(() => {});
    throw new AppError(ATTENTION, 503);
  }
}
