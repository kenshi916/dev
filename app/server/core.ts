import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../chatgpt-auth";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const db = () => {
  if (!env.DB) throw new AppError("Workspace storage is not available.", 503);
  return env.DB;
};
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export async function userId() {
  const u = await getChatGPTUser();
  if (!u) throw new AppError("Sign in to use your workspace.", 401);
  return u.userId;
}
export async function body(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new AppError("Request origin is not allowed.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("Cross-site request denied.", 403);
  const raw = await request.text();
  if (raw.length > 20000) throw new AppError("Request is too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Invalid request.");
  }
}
export const fail = (e: unknown) =>
  Response.json(
    {
      error:
        e instanceof AppError
          ? e.message
          : "The service could not finish this request. Please try again.",
    },
    {
      status: e instanceof AppError ? e.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
export function textValue(v: unknown, max: number, min = 1) {
  if (typeof v !== "string" || v.trim().length < min || v.trim().length > max)
    throw new AppError("Please check the text length.");
  return v.trim();
}
export async function rows(sql: string, ...args: any[]) {
  return (
    await db()
      .prepare(sql)
      .bind(...args)
      .all()
  ).results as any[];
}
export async function one(sql: string, ...args: any[]) {
  return await db()
    .prepare(sql)
    .bind(...args)
    .first<any>();
}
export async function change(sql: string, ...args: any[]) {
  return db()
    .prepare(sql)
    .bind(...args)
    .run();
}
export async function event(
  owner: string,
  agent: string,
  kind: string,
  message: string,
) {
  await change(
    "INSERT INTO events (id,owner,agent_id,kind,message,created_at) VALUES (?,?,?,?,?,?)",
    id(),
    owner,
    agent,
    kind,
    message.slice(0, 4000),
    now(),
  );
}
function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function aes() {
  const secret = (env as any).CREDENTIAL_SECRET;
  if (!secret || secret.length < 32)
    throw new AppError(
      "Credential encryption is not configured on this server.",
      503,
    );
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encrypt(value: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await aes(),
    new TextEncoder().encode(value),
  );
  return b64(iv) + "." + b64(new Uint8Array(ciphertext));
}
export async function decrypt(value: string, context: string) {
  const [iv, data] = value.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unb64(iv),
        additionalData: new TextEncoder().encode(context),
      },
      await aes(),
      unb64(data),
    ),
  );
}
export async function setSecret(
  owner: string,
  provider: string,
  value: string,
) {
  await change(
    "INSERT INTO secrets (owner,provider,value) VALUES (?,?,?) ON CONFLICT(owner,provider) DO UPDATE SET value=excluded.value",
    owner,
    provider,
    await encrypt(value, owner + ":" + provider),
  );
}
export async function secret(owner: string, provider: string) {
  const row = await one(
    "SELECT value FROM secrets WHERE owner=? AND provider=?",
    owner,
    provider,
  );
  if (!row)
    throw new AppError("Connect " + provider + " in Connections first.");
  return decrypt(row.value, owner + ":" + provider);
}
export async function setting(
  owner: string,
  key: string,
  fallback: any = null,
) {
  const row = await one(
    "SELECT value FROM settings WHERE owner=? AND key=?",
    owner,
    key,
  );
  return row ? JSON.parse(row.value) : fallback;
}
export async function setSetting(owner: string, key: string, value: any) {
  await change(
    "INSERT INTO settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value",
    owner,
    key,
    JSON.stringify(value),
  );
}
export async function external(
  url: string,
  init: RequestInit = {},
  label = "Service",
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal || AbortSignal.timeout(30000),
    });
  } catch {
    throw new AppError(label + " could not be reached. Please try again.", 502);
  }
  if (!response.ok)
    throw new AppError(
      response.status === 429
        ? label + " rate limit reached. Try again later."
        : label +
            " rejected the request (" +
            response.status +
            "). Check your connection and account access.",
      502,
    );
  return response;
}
export function httpsPublic(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new AppError("Enter a valid HTTPS URL.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !u.hostname.includes(".") ||
    /^\d+\./.test(u.hostname) ||
    u.hostname.includes(":") ||
    u.hostname.endsWith(".local") ||
    u.hostname.endsWith(".internal") ||
    u.hostname === "localhost"
  )
    throw new AppError("Use a public HTTPS endpoint.");
  return u.toString();
}
export async function rpc(owner: string, method: string, params: any[], options: { signal?: AbortSignal } = {}) {
  let url: string;
  try {
    url = await secret(owner, "rpc");
  } catch (e) {
    if (
      !["getSignaturesForAddress", "getTransaction", "getAccountInfo"].includes(
        method,
      )
    )
      throw e;
    url = "https://api.mainnet-beta.solana.com";
  }
  const r = await external(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: options.signal,
    },
    "Solana RPC",
  );
  const d: any = await r.json();
  if (d.error)
    throw new AppError(
      "Solana RPC could not complete " +
        method +
        ". Check RPC access, funding, and network.",
      502,
    );
  return d.result;
}
// Public network claims must not rely on a viewer's configurable RPC endpoint.
export async function publicLaunchTransaction(signature: string, encoding: "jsonParsed" | "base64" = "jsonParsed") {
  const url = (env as any).DEV_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const r = await external(httpsPublic(url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature,
      { encoding, maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }),
  }, "Public Solana verification");
  const data: any = await r.json();
  if (data.error) throw new AppError("Public launch verification is unavailable. The coin remains unconfirmed in Activity.", 502);
  return data.result;
}

export async function uploadPinata(owner: string, file: File) {
  const token = await secret(owner, "pinata");
  const form = new FormData();
  form.set("network", "public");
  form.set("file", file);
  const r = await external(
    "https://uploads.pinata.cloud/v3/files",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: form,
    },
    "Pinata",
  );
  const d: any = await r.json();
  if (!/^[a-zA-Z0-9]+$/.test(d.data?.cid || ""))
    throw new AppError("Pinata did not return an IPFS identifier.", 502);
  return "https://ipfs.io/ipfs/" + d.data.cid;
}
