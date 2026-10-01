import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
function load(path, dependencies, globals) {
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
    Request, Response, Headers, TextEncoder, TextDecoder, URL, URLSearchParams,
    ReadableStream, AbortSignal, crypto: globalThis.crypto, Uint8Array, Buffer, btoa, atob,
    ...globals,
  }, { filename });
  return evaluated.exports;
}

async function harness(t, respond) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("drizzle/0000_broad_apocalypse.sql", root), "utf8"));
  t.after(() => sql.close());
  let clock = Date.now();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const database = {
    prepare(query) {
      const statement = sql.prepare(query);
      const bind = (...args) => ({
        bind: (...values) => bind(...values),
        async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
      });
      return bind();
    },
  };
  const requests = [];
  const fetch = async (url, init) => {
    const address = new URL(url);
    assert.equal(address.origin, "https://api.x.com");
    assert.equal(address.pathname, "/2/tweets/search/recent");
    assert.equal(init.headers.Authorization, "Bearer fixture-token");
    assert.equal(init.redirect, "manual");
    requests.push(address);
    return respond(address, requests.length, clock);
  };
  const globals = { fetch, Date: ClockDate };
  const core = load("app/server/core.ts", {
    "cloudflare:workers": { env: { DB: database, CREDENTIAL_SECRET: "fixture-only-key-for-memory-tests-32" } },
    "../chatgpt-auth": { getChatGPTUser: async () => ({ userId: "owner-a" }) },
  }, globals);
  const service = load("app/server/twitter.ts", { "./core": core }, globals);
  await core.setSecret("owner-a", "x", "Bearer fixture-token");
  function track(id, query, owner = "owner-a") {
    sql.prepare("INSERT INTO tracks (id,owner,kind,query,label) VALUES (?,?,'tweet',?,'')").run(id, owner, query);
  }
  return { sql, requests, core, service, track, advance(ms) { clock += ms; } };
}
const page = (id, extras = {}) => Response.json({
  data: [{ id, author_id: "42", text: "A public source signal", created_at: "2026-09-20T12:00:00.000Z", public_metrics: { like_count: 3 } }],
  includes: { users: [{ id: "42", username: "researcher" }] },
  meta: { newest_id: id, result_count: 1, ...extras },
});

test("uses the saved bearer and marks configured access verified only after success", async (t) => {
  const h = await harness(t, () => Response.json({
    data: [{ id: "100", author_id: "42", text: "Short text", note_tweet: { text: "Complete long-form post text" } }],
    meta: { newest_id: "100", result_count: 1 },
  }));
  h.track("a", "@researcher");
  assert.equal((await h.service.readTwitterStatus("owner-a")).state, "configured");
  const result = await h.service.refreshTweets("owner-a");
  assert.equal(result.saved, 1);
  assert.equal(h.requests[0].searchParams.get("query"), "from:researcher -is:retweet");
  assert.equal(h.requests[0].searchParams.get("max_results"), "10");
  const saved = h.sql.prepare("SELECT * FROM signals WHERE owner='owner-a'").get();
  assert.equal(saved.text, "Complete long-form post text");
  assert.equal(saved.url, "https://x.com/i/web/status/100");
  assert.equal((await h.service.readTwitterStatus("owner-a")).state, "ready");
  const skipped = await h.service.refreshTweets("owner-a");
  assert.equal(skipped.checked, 0);
  assert.equal(h.requests.length, 1);
});

test("finishes pagination before advancing since_id to the first page's newest post", async (t) => {
  const h = await harness(t, (_url, count) => count === 1 ? page("200", { next_token: "next-page" }) : count === 2 ? page("150") : page("300"));
  h.track("a", "research");
  await h.core.setSetting("owner-a", "twitter_track_a", { query: "research", sinceId: "100" });
  assert.equal((await h.service.refreshTweets("owner-a")).hasBacklog, true);
  h.advance(120001);
  await h.service.refreshTweets("owner-a");
  assert.equal(h.requests[1].searchParams.get("since_id"), "100");
  assert.equal(h.requests[1].searchParams.get("next_token"), "next-page");
  h.advance(120001);
  await h.service.refreshTweets("owner-a");
  assert.equal(h.requests[2].searchParams.get("since_id"), "200");
  assert.equal(h.requests[2].searchParams.has("next_token"), false);
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM signals").get().n, 3);
});

test("one invalid query does not block another tracker or mark the failed one checked", async (t) => {
  const h = await harness(t, (url) => url.searchParams.get("query") === "bad query" ? new Response("Do not expose provider error details", { status: 400 }) : page("100"));
  h.track("a", "bad query"); h.track("b", "good query");
  const result = await h.service.refreshTweets("owner-a");
  assert.equal(result.checked, 1); assert.equal(result.errors.length, 1);
  assert.equal(h.sql.prepare("SELECT last_checked FROM tracks WHERE id='a'").get().last_checked, null);
  assert.ok(h.sql.prepare("SELECT last_checked FROM tracks WHERE id='b'").get().last_checked);
  assert.equal((await h.service.readTwitterStatus("owner-a")).state, "partial");
  assert.ok(!JSON.stringify(result).includes("Do not expose"));
});

test("provider rate-limit backoff suppresses paid retries until its reset time", async (t) => {
  const h = await harness(t, (_url, count, clock) => count === 1 ? new Response("rate limited", { status: 429, headers: { "x-rate-limit-reset": String(Math.ceil((clock + 300000) / 1000)) } }) : page("100"));
  h.track("a", "research");
  await assert.rejects(h.service.refreshTweets("owner-a"), (error) => error.status === 429);
  h.advance(120001);
  await assert.rejects(h.service.refreshTweets("owner-a"), (error) => error.status === 429);
  assert.equal(h.requests.length, 1);
  h.advance(181000);
  assert.equal((await h.service.refreshTweets("owner-a")).checked, 1);
});

test("invalid credentials stop the remaining queries; replacing them clears validation and backoff", async (t) => {
  const h = await harness(t, () => new Response("fixture-token must never be echoed", { status: 401 }));
  h.track("a", "first"); h.track("b", "second");
  await h.core.setSetting("owner-a", "twitter_track_a", { query: "first", sinceId: "90" });
  await assert.rejects(h.service.refreshTweets("owner-a"), (error) => /Bearer Token/.test(error.message) && !error.message.includes("fixture-token"));
  assert.equal(h.requests.length, 1);
  await h.service.resetTwitterStatus("owner-a");
  assert.equal((await h.service.readTwitterStatus("owner-a")).state, "configured");
  assert.equal((await h.core.setting("owner-a", "twitter_track_a")).sinceId, "90");
});

test("concurrent refreshes fetch a tracker once and owner cursors remain isolated", async (t) => {
  const h = await harness(t, () => page("100"));
  h.track("a", "research"); h.track("b", "other", "owner-b");
  await h.core.setSecret("owner-b", "x", "fixture-token");
  const results = await Promise.all([h.service.refreshTweets("owner-a"), h.service.refreshTweets("owner-a")]);
  assert.equal(results.reduce((sum, result) => sum + result.checked, 0), 1);
  assert.equal(h.requests.length, 1);
  assert.equal(await h.core.setting("owner-b", "twitter_track_a"), null);
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM signals WHERE owner='owner-b'").get().n, 0);
});

test("malformed responses preserve cursor and rejected pagination resets only the page token", async (t) => {
  const h = await harness(t, (_url, count) => count === 1 ? Response.json({ data: [{ id: "malformed", text: "Invalid ID" }] }) : new Response("Invalid next_token", { status: 400 }));
  h.track("a", "research");
  await h.core.setSetting("owner-a", "twitter_track_a", { query: "research", sinceId: "100", newestId: "200", nextToken: "saved-page" });
  await assert.rejects(h.service.refreshTweets("owner-a"));
  assert.equal((await h.core.setting("owner-a", "twitter_track_a")).nextToken, "saved-page");
  h.advance(30001);
  await assert.rejects(h.service.refreshTweets("owner-a"));
  const cursor = await h.core.setting("owner-a", "twitter_track_a");
  assert.equal(cursor.sinceId, "100"); assert.equal(cursor.nextToken, undefined); assert.equal(cursor.newestId, undefined);
});

test("redirects stop refresh without forwarding credentials and preserve the checkpoint", async (t) => {
  const h = await harness(t, () => new Response("fixture-token", { status: 307, headers: { Location: "https://other.test/fixture-token" } }));
  h.track("a", "first"); h.track("b", "second");
  await h.core.setSetting("owner-a", "twitter_track_a", { query: "first", sinceId: "100" });
  await assert.rejects(h.service.refreshTweets("owner-a"), (e) => /redirected/.test(e.message) && !e.message.includes("fixture-token"));
  assert.equal(h.requests.length, 1);
  assert.equal((await h.core.setting("owner-a", "twitter_track_a")).sinceId, "100");
});
