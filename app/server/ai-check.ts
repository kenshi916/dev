// Server-only. Provider credentials stay in the Authorization header.
import { openRouterAccess } from "./ai-access";
import { AppError } from "./core";

export type AIConnectionCheck = {
  source: "personal" | "sponsored";
  /** Per-key allowance, not the OpenRouter account's funded balance. */
  limitUsd: number | null;
  remainingUsd: number | null;
  usageUsd: number;
  expiresAt: string | null;
  reply?: string;
  model?: string;
};

const API = "https://openrouter.ai/api/v1";
const NO_CREDIT = "OpenRouter could not authorize this test. Your account may need credits, or this key may have reached its spending limit.";
const INVALID = "OpenRouter returned an invalid connection response. Please try again.";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function providerError(status: number): never {
  if (status === 402) throw new AppError(NO_CREDIT, 402);
  if (status === 401 || status === 403)
    throw new AppError("OpenRouter access was denied. Reconnect your account in Connections.", 403);
  if (status === 429)
    throw new AppError("OpenRouter is temporarily rate limited. Wait before testing again.", 429);
  throw new AppError("OpenRouter could not complete this connection test. Please try again.", 502);
}
async function request(apiKey: string, path: "/key" | "/chat/completions", payload?: object) {
  let response: Response;
  try {
    response = await fetch(API + path, {
      method: payload ? "POST" : "GET",
      headers: { Authorization: "Bearer " + apiKey, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(payload ? 30000 : 15000),
      // Workers supports manual/follow; reject 3xx below without forwarding credentials.
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    // Do not expose network errors or provider bodies: either may contain credentials.
    throw new AppError("OpenRouter could not be reached. Please try again.", 502);
  }
  if (response.status >= 300 && response.status < 400)
    throw new AppError("OpenRouter redirected the connection test. Please try again later.", 502);
  if (!response.ok) providerError(response.status);
  let result: Record<string, unknown>;
  try { result = object(await response.json()); }
  catch { throw new AppError(INVALID, 502); }
  // Some providers report a completion failure inside an otherwise successful response.
  if (result.error) providerError(Number(object(result.error).code));
  return result;
}

/** Explicit user-triggered check only. Supplying a model makes one small billable request. */
export async function aiConnectionCheck(owner: string, model?: string): Promise<AIConnectionCheck> {
  if (model !== undefined && (typeof model !== "string" || model.length > 200 || model !== model.trim() ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(model) || /:online$/i.test(model)))
    throw new AppError("Choose a valid model for the connection test.");

  const { apiKey, source } = await openRouterAccess(owner);
  const data = object((await request(apiKey, "/key")).data);
  const limit = data.limit;
  const remaining = data.limit_remaining;
  const usage = data.usage;
  const expiry = data.expires_at;
  if ((limit !== null && (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0)) ||
    (remaining !== null && (typeof remaining !== "number" || !Number.isFinite(remaining))) ||
    (limit !== null && remaining === null) ||
    typeof usage !== "number" || !Number.isFinite(usage) || usage < 0 ||
    (expiry !== null && expiry !== undefined &&
      (typeof expiry !== "string" || !Number.isFinite(Date.parse(expiry)))))
    throw new AppError(INVALID, 502);

  // Whitelist typed values. Never return provider labels, hashes, keys or raw metadata.
  const result: AIConnectionCheck = {
    source,
    limitUsd: limit as number | null,
    remainingUsd: remaining === null ? null : Math.max(0, remaining as number),
    usageUsd: usage,
    expiresAt: typeof expiry === "string" ? new Date(expiry).toISOString() : null,
  };
  if (model === undefined) return result;
  if (result.remainingUsd !== null && result.remainingUsd <= 0) throw new AppError(NO_CREDIT, 402);
  if (result.expiresAt && Date.parse(result.expiresAt) <= Date.now())
    throw new AppError("Your OpenRouter connection has expired. Reconnect your account in Connections.", 403);
  if (data.disabled === true)
    throw new AppError("Your OpenRouter connection is disabled. Reconnect your account in Connections.", 403);

  const completion = await request(apiKey, "/chat/completions", {
    model,
    messages: [{ role: "user", content: "Reply with exactly: Dev AI is connected." }],
    max_tokens: 64,
    stream: false,
  });
  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const content = object(object(choices[0]).message).content;
  if (typeof content !== "string" || !content.trim() || content.includes(apiKey))
    throw new AppError("OpenRouter returned no usable test reply. Try another model.", 502);
  return { ...result, model, reply: content.trim().slice(0, 512) };
}
