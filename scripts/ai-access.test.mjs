import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const project = new URL("../", import.meta.url);
const RECORD_KEY = "ai_sponsored_access_v1";
const HASH = "a".repeat(64);
const CHILD = "test-child-secret-do-not-return-to-browser";
const MANAGEMENT = "test-management-secret";

function loadModule(path, dependencies, mockFetch) {
  const filename = fileURLToPath(new URL(path, project));
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const evaluated = { exports: {} };
  vm.runInNewContext(source, {
    module: evaluated, exports: evaluated.exports,
    require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error("Unexpected dependency: " + name);
    },
    fetch: mockFetch, Response, Request, Headers, AbortSignal, TextEncoder, TextDecoder,
    URL, crypto: globalThis.crypto, Uint8Array, btoa, atob,
  }, { filename });
  return evaluated.exports;
}

function harness(t, enabled = true) {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE settings(owner TEXT,key TEXT,value TEXT,PRIMARY KEY(owner,key)); CREATE TABLE secrets(owner TEXT,provider TEXT,value TEXT,PRIMARY KEY(owner,provider));");
  t.after(() => sql.close());
  const calls = [];
  let saveFailure = "";
  const database = {
    prepare(query) {
      const statement = sql.prepare(query);
      const bound = (...args) => ({
        bind: (...values) => bound(...values),
        async first() { return statement.get(...args) || null; },
        async run() {
          const savingReady = query.startsWith("UPDATE settings") && JSON.parse(args[0]).state === "ready";
          if (savingReady && saveFailure === "before") throw new Error("Simulated storage failure");
          const changes = Number(statement.run(...args).changes);
          if (savingReady && saveFailure === "after") throw new Error("Simulated lost commit response");
          return { meta: { changes } };
        },
      });
      return bound();
    },
  };
  const bindings = {
    DB: database, CREDENTIAL_SECRET: "a-test-only-encryption-secret-with-over-32-characters",
    DEV_SPONSORED_AI_ENABLED: String(enabled), OPENROUTER_MANAGEMENT_KEY: MANAGEMENT,
    DEV_SPONSORED_AI_OWNERS: "owner-a,owner-b", DEV_SPONSORED_AI_DAILY_USD: "1.00",
  };
  const data = { hash: HASH, disabled: false, limit: 1, limit_reset: "daily", include_byok_in_limit: true, limit_remaining: 1, expires_at: null };
  let handler = async (_url, init) => new Response(JSON.stringify({ data, ...(init.method === "POST" ? { key: CHILD } : {}) }), { status: init.method === "POST" ? 201 : 200 });
  const mockFetch = async (url, init) => {
    assert.ok(url === "https://openrouter.ai/api/v1/keys" || url === "https://openrouter.ai/api/v1/keys/" + HASH, "No inference or payment endpoints may be called");
    calls.push({ url, ...init });
    return handler(url, init);
  };
  const core = loadModule("app/server/core.ts", {
    "cloudflare:workers": { env: bindings }, "../chatgpt-auth": { getChatGPTUser: async () => ({ userId: "owner-a" }) },
  }, mockFetch);
  const reload = () => loadModule("app/server/ai-access.ts", { "cloudflare:workers": { env: bindings }, "./core": core }, mockFetch);
  return {
    sql, bindings, data, calls, core, access: reload(), reload,
    setHandler(fn) { handler = fn; }, failSave(mode) { saveFailure = mode; },
    saved(owner = "owner-a") { const row = sql.prepare("SELECT value FROM settings WHERE owner=? AND key=?").get(owner, RECORD_KEY); return row ? JSON.parse(row.value) : null; },
  };
}

test("disabled sponsorship and unknown owners never provision or contact the provider", async (t) => {
  const h = harness(t, false);
  await assert.rejects(h.access.openRouterAccess("owner-a"), /not enabled/);
  h.bindings.DEV_SPONSORED_AI_ENABLED = "true";
  await assert.rejects(h.access.openRouterAccess("unknown-owner"), /not enabled/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved(), null);
});

test("invalid caps, wildcard allowlists, missing management key and missing encryption fail closed", async (t) => {
  const h = harness(t);
  for (const invalid of ["", "0", "-1", "Infinity", "NaN", "1e2", "0.001", "100.01"]) {
    h.bindings.DEV_SPONSORED_AI_DAILY_USD = invalid;
    assert.equal((await h.access.aiAccessStatus("owner-a")).available, false);
    await assert.rejects(h.access.openRouterAccess("owner-a"));
  }
  h.bindings.DEV_SPONSORED_AI_DAILY_USD = "1.00";
  for (const [key, value] of [["DEV_SPONSORED_AI_OWNERS", "*"], ["OPENROUTER_MANAGEMENT_KEY", ""], ["CREDENTIAL_SECRET", "short"]]) {
    const previous = h.bindings[key]; h.bindings[key] = value;
    await assert.rejects(h.access.openRouterAccess("owner-a")); h.bindings[key] = previous;
  }
  assert.equal(h.calls.length, 0);
});

test("personal credentials always win, including while sponsorship is disabled", async (t) => {
  const h = harness(t, false);
  await h.core.setSecret("owner-a", "openrouter", "personal-test-key");
  const result = await h.access.openRouterAccess("owner-a");
  assert.equal(result.apiKey, "personal-test-key");
  assert.equal(result.source, "personal");
  assert.equal(h.calls.length, 0);
});

test("corrupt personal credentials do not silently spend platform funds", async (t) => {
  const h = harness(t);
  h.sql.prepare("INSERT INTO secrets VALUES(?,?,?)").run("owner-a", "openrouter", "corrupt");
  await assert.rejects(h.access.openRouterAccess("owner-a"), /Reconnect/);
  assert.equal(h.calls.length, 0);
});

test("approved owner gets one encrypted child key with provider-enforced daily USD and BYOK caps", async (t) => {
  const h = harness(t);
  const result = await h.access.openRouterAccess("owner-a");
  assert.equal(result.source, "sponsored");
  assert.equal(result.apiKey, CHILD);
  const request = JSON.parse(h.calls[0].body);
  assert.equal(request.limit, 1);
  assert.equal(request.limit_reset, "daily");
  assert.equal(request.include_byok_in_limit, true);
  assert.equal(h.calls[0].headers.Authorization, "Bearer " + MANAGEMENT);
  assert.equal(h.calls[0].redirect, "manual");
  assert.equal(h.saved().state, "ready");
  assert.ok(!JSON.stringify(h.saved()).includes(CHILD));
  assert.equal(await h.core.decrypt(h.saved().sealedKey, "owner-a:openrouter-sponsored:v1"), CHILD);
  await assert.rejects(h.core.decrypt(h.saved().sealedKey, "owner-b:openrouter-sponsored:v1"));
  assert.equal((await h.reload().openRouterAccess("owner-a")).apiKey, CHILD);
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
});

test("concurrent requests across module instances cannot create duplicate per-owner budgets", async (t) => {
  const h = harness(t);
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => h.reload().openRouterAccess("owner-a")));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(h.saved().state, "ready");
});

test("unknown creation outcome blocks all retries including after a process restart", async (t) => {
  const h = harness(t);
  h.setHandler(async () => { throw new Error("Timed out after provider may have created a key"); });
  await assert.rejects(h.access.openRouterAccess("owner-a"), /administrator attention/);
  assert.equal(h.saved().state, "attention");
  await assert.rejects(h.reload().openRouterAccess("owner-a"), /administrator attention/);
  assert.equal(h.calls.length, 1);
});

test("an interrupted pending record never expires into a second provisioning attempt", async (t) => {
  const h = harness(t);
  h.sql.prepare("INSERT INTO settings VALUES(?,?,?)").run("owner-a", RECORD_KEY, JSON.stringify({ version: 1, state: "pending", attempt: "old-attempt", createdAt: "2000-01-01T00:00:00Z", dailyLimitUsd: 1 }));
  await assert.rejects(h.access.openRouterAccess("owner-a"), /pending/);
  assert.equal(h.calls.length, 0);
});

test("unconfirmed limit enforcement or missing one-time key prevents storing usable access", async (t) => {
  for (const variant of ["uncapped", "wrong-reset", "no-byok", "missing-key", "wrong-hash", "empty-remaining"]) {
    const h = harness(t);
    h.setHandler(async () => new Response(JSON.stringify({
      data: { ...h.data, ...(variant === "uncapped" ? { limit: null } : {}), ...(variant === "wrong-reset" ? { limit_reset: "monthly" } : {}), ...(variant === "no-byok" ? { include_byok_in_limit: false } : {}), ...(variant === "wrong-hash" ? { hash: "../../unknown" } : {}), ...(variant === "empty-remaining" ? { limit_remaining: null } : {}) },
      ...(variant === "missing-key" ? {} : { key: CHILD }),
    }), { status: 201 }));
    await assert.rejects(h.access.openRouterAccess("owner-a"), /administrator attention/);
    assert.equal(h.saved().state, "attention");
    assert.equal(h.saved().sealedKey, undefined);
  }
});

test("failed persistence blocks reprovisioning and records provider hash for operator reconciliation", async (t) => {
  const h = harness(t); h.failSave("before");
  await assert.rejects(h.access.openRouterAccess("owner-a"));
  assert.equal(h.saved().state, "attention");
  assert.equal(h.saved().hash, HASH);
  await assert.rejects(h.reload().openRouterAccess("owner-a"));
  assert.equal(h.calls.length, 1);
});

test("lost successful database response preserves the encrypted key and reuses its budget", async (t) => {
  const h = harness(t); h.failSave("after");
  await assert.rejects(h.access.openRouterAccess("owner-a"));
  assert.equal(h.saved().state, "ready");
  assert.equal((await h.reload().openRouterAccess("owner-a")).apiKey, CHILD);
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
});

test("existing keys fail closed when disabled, exhausted, expired, or cap is increased externally", async (t) => {
  const h = harness(t); await h.access.openRouterAccess("owner-a");
  for (const patch of [{ disabled: true }, { limit_remaining: 0 }, { expires_at: "2000-01-01T00:00:00Z" }, { limit: 10 }, { limit_reset: null }, { include_byok_in_limit: false }]) {
    h.setHandler(async () => new Response(JSON.stringify({ data: { ...h.data, ...patch } })));
    await assert.rejects(h.access.openRouterAccess("owner-a"));
  }
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
});

test("removing approval or tightening local cap prevents use of an existing sponsored key", async (t) => {
  const h = harness(t); await h.access.openRouterAccess("owner-a");
  h.bindings.DEV_SPONSORED_AI_OWNERS = "owner-b";
  await assert.rejects(h.access.openRouterAccess("owner-a"), /not enabled/);
  assert.equal(h.calls.length, 1);
  h.bindings.DEV_SPONSORED_AI_OWNERS = "owner-a";
  h.bindings.DEV_SPONSORED_AI_DAILY_USD = "0.50";
  await assert.rejects(h.access.openRouterAccess("owner-a"), /administrator attention/);
});

test("public status is read-only, eligibility is not a funded balance, and no key material leaks", async (t) => {
  const h = harness(t);
  const before = await h.access.aiAccessStatus("owner-a");
  assert.equal(before.available, true);
  assert.equal(before.source, "sponsored");
  assert.equal(before.dailyLimitUsd, 1);
  assert.equal(before.sponsored.funding, "not_verified");
  assert.equal(before.sponsored.provisioning, "not_started");
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved(), null);
  await h.access.openRouterAccess("owner-a");
  const status = await h.access.aiAccessStatus("owner-a");
  const serialized = JSON.stringify(status);
  for (const sensitive of [CHILD, MANAGEMENT, HASH, h.saved().sealedKey]) assert.ok(!serialized.includes(sensitive));
  assert.equal(status.sponsored.funding, "not_verified");
  assert.equal(status.sponsored.provisioning, "ready");
});

test("provider error details are not exposed to the browser", async (t) => {
  const h = harness(t);
  h.setHandler(async () => new Response(JSON.stringify({ error: { message: MANAGEMENT + CHILD } }), { status: 500 }));
  await assert.rejects(h.access.openRouterAccess("owner-a"), (error) => !error.message.includes(CHILD) && !error.message.includes(MANAGEMENT));
});

test("provider redirects fail closed and never forward the management credential", async (t) => {
  const h = harness(t);
  h.setHandler(async () => new Response(MANAGEMENT, { status: 307, headers: { Location: "https://other.test/" + MANAGEMENT } }));
  await assert.rejects(h.access.openRouterAccess("owner-a"), (error) => !error.message.includes(MANAGEMENT));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].redirect, "manual");
  assert.equal(h.saved().state, "attention");
});
