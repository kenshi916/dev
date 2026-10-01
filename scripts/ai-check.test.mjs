import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
function load(path, dependencies, globals = {}) {
  const filename = fileURLToPath(new URL(path, root));
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const evaluated = { exports: {} };
  vm.runInNewContext(source, {
    module: evaluated, exports: evaluated.exports,
    require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error("Unexpected module access: " + name);
    },
    Response, AbortSignal, ...globals,
  }, { filename });
  return evaluated.exports;
}

const keyData = (extra = {}) => ({
  data: { limit: 5, limit_remaining: 4.95, usage: 0.05, expires_at: "2099-10-30T23:59:59Z", ...extra },
});
function harness(respond, source = "personal") {
  const requests = [];
  const owners = [];
  const core = load("app/server/core.ts", {
    "cloudflare:workers": { env: {} },
    "../chatgpt-auth": { getChatGPTUser: async () => null },
  });
  const service = load("app/server/ai-check.ts", {
    "./core": core,
    "./ai-access": { async openRouterAccess(owner) {
      owners.push(owner);
      return { apiKey: "fixture-secret-token", source };
    } },
  }, {
    async fetch(url, init) {
      const address = new URL(url);
      assert.equal(address.origin, "https://openrouter.ai");
      assert.ok(["/api/v1/key", "/api/v1/chat/completions"].includes(address.pathname));
      assert.equal(init.headers.Authorization, "Bearer fixture-secret-token");
      assert.equal(init.redirect, "manual");
      assert.equal(init.cache, "no-store");
      assert.ok(init.signal instanceof AbortSignal);
      assert.ok(!url.includes("fixture-secret-token"));
      assert.ok(!String(init.body).includes("fixture-secret-token"));
      requests.push({ path: address.pathname, ...init });
      return respond(requests.at(-1), requests.length);
    },
  });
  return { ...service, requests, owners, core };
}
const safe = (value) => JSON.parse(JSON.stringify(value));

test("metadata check reads the authenticated owner's key and exposes only safe typed fields", async () => {
  const h = harness(() => Response.json(keyData({ label: "fixture-secret-token", hash: "private-hash", key: "fixture-secret-token" })));
  assert.deepEqual(safe(await h.aiConnectionCheck("owner-a")), {
    source: "personal", limitUsd: 5, remainingUsd: 4.95, usageUsd: 0.05,
    expiresAt: "2099-10-30T23:59:59.000Z",
  });
  assert.deepEqual(h.owners, ["owner-a"]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, "GET");
  assert.equal(h.requests[0].body, undefined);
});

test("inference checks allowance first then sends one fixed benign 64-token request", async () => {
  const h = harness((_request, count) => count === 1 ? Response.json(keyData()) :
    Response.json({ choices: [{ message: { content: "Dev AI is connected.", reasoning: "private reasoning" } }], key: "fixture-secret-token" }), "sponsored");
  const result = await h.aiConnectionCheck("owner-b", "provider/model");
  assert.equal(result.source, "sponsored");
  assert.equal(result.reply, "Dev AI is connected.");
  assert.equal(result.model, "provider/model");
  assert.deepEqual(h.requests.map((r) => r.path), ["/api/v1/key", "/api/v1/chat/completions"]);
  assert.deepEqual(JSON.parse(h.requests[1].body), {
    model: "provider/model", messages: [{ role: "user", content: "Reply with exactly: Dev AI is connected." }], max_tokens: 64, stream: false,
  });
  assert.ok(!JSON.stringify(result).includes("private reasoning"));
});

test("unlimited per-key allowance remains null; it does not invent a funded balance", async () => {
  const h = harness(() => Response.json(keyData({ limit: null, limit_remaining: null, expires_at: null })));
  const result = await h.aiConnectionCheck("owner-a");
  assert.equal(result.limitUsd, null);
  assert.equal(result.remainingUsd, null);
  assert.equal(result.expiresAt, null);
});

test("exhausted, expired, disabled and malformed metadata never reaches inference", async () => {
  for (const [extra, status] of [
    [{ limit_remaining: 0 }, 402], [{ limit_remaining: -1 }, 402],
    [{ expires_at: "2020-01-01T00:00:00Z" }, 403], [{ disabled: true }, 403],
    [{ limit_remaining: null }, 502], [{ usage: "secret" }, 502],
    [{ limit: "5" }, 502], [{ expires_at: "invalid" }, 502],
  ]) {
    const h = harness(() => Response.json(keyData(extra)));
    await assert.rejects(h.aiConnectionCheck("owner-a", "provider/model"), (e) => e instanceof h.core.AppError && e.status === status);
    assert.equal(h.requests.length, 1);
  }
});

test("provider credit, auth, rate-limit, network and embedded errors expose no raw secrets", async () => {
  for (const status of [401, 402, 403, 429, 500]) {
    const h = harness(() => Response.json({ error: { message: "fixture-secret-token", code: status } }, { status }));
    await assert.rejects(h.aiConnectionCheck("owner-a", "provider/model"), (e) => {
      assert.ok(!e.message.includes("fixture-secret-token"));
      return e.status === (status === 401 ? 403 : status === 500 ? 502 : status);
    });
    assert.equal(h.requests.length, 1);
  }
  const network = harness(() => { throw new Error("fixture-secret-token"); });
  await assert.rejects(network.aiConnectionCheck("owner-a"), (e) => e.status === 502 && !e.message.includes("fixture-secret-token"));
  const embedded = harness((_r, count) => count === 1 ? Response.json(keyData()) : Response.json({ error: { code: 402, message: "fixture-secret-token" } }));
  await assert.rejects(embedded.aiConnectionCheck("owner-a", "provider/model"), (e) => e.status === 402 && !e.message.includes("fixture-secret-token"));
  assert.equal(embedded.requests.length, 2);
});

test("invalid model inputs and web-search variants do not acquire access or make requests", async () => {
  for (const model of ["", "a".repeat(201), "provider/model\n", "provider/model:online", "https://other.test", null, {}]) {
    const h = harness(() => { throw new Error("Unexpected provider call"); });
    await assert.rejects(h.aiConnectionCheck("owner-a", model), (e) => e.status === 400);
    assert.equal(h.requests.length, 0);
    assert.equal(h.owners.length, 0);
  }
});

test("redirects are rejected without following locations or sending another request", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const h = harness(() => new Response("fixture-secret-token", { status, headers: { Location: "https://other.test/fixture-secret-token" } }));
    await assert.rejects(h.aiConnectionCheck("owner-a", "provider/model"), (e) => e.status === 502 && !e.message.includes("fixture-secret-token"));
    assert.equal(h.requests.length, 1);
  }
});

test("completion returns bounded visible text only and rejects empty or credential-bearing replies", async () => {
  for (const content of [null, "", "  ", "fixture-secret-token"]) {
    const h = harness((_r, count) => count === 1 ? Response.json(keyData()) : Response.json({ choices: [{ message: { content, reasoning: "do not return" } }] }));
    await assert.rejects(h.aiConnectionCheck("owner-a", "provider/model"), (e) => e.status === 502);
  }
  const h = harness((_r, count) => count === 1 ? Response.json(keyData()) : Response.json({ choices: [{ message: { content: "a".repeat(1000) } }] }));
  assert.equal((await h.aiConnectionCheck("owner-a", "provider/model")).reply.length, 512);
});
