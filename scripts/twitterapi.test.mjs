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
    assert.equal(address.origin, "https://api.twitterapi.io");
    assert.equal(address.pathname, "/twitter/tweet/advanced_search");
    assert.equal(init.headers["X-API-Key"], "fixture-token");
    assert.equal(init.redirect, "manual");
    requests.push(address);
    return respond(address, requests.length, clock);
  };
  const globals = { fetch, Date: ClockDate };
  const core = load("app/server/core.ts", {
    "cloudflare:workers": { env: { DB: database, CREDENTIAL_SECRET: "fixture-only-key-for-memory-tests-32" } },
    "../chatgpt-auth": { getChatGPTUser: async () => ({ userId: "owner-a" }) },
  }, globals);
  const service = load("app/server/twitterapi.ts", { "./core": core }, globals);
  await core.setSecret("owner-a", "twitterapi", "fixture-token");
  function track(id, query, owner = "owner-a") {
    sql.prepare("INSERT INTO tracks (id,owner,kind,query,label) VALUES (?,?,'tweet',?,'')").run(id, owner, query);
  }
  return { sql, requests, core, service, track, advance(ms) { clock += ms; } };
}
const page = (id, more = false, cursor = "") => Response.json({ tweets: [{ id, text: "Public tweet", createdAt: "2026-09-30T20:00:00Z", likeCount: 4, author: { userName: "researcher" } }], has_next_page: more, next_cursor: cursor });

test("provider key stays in the header, maps posts, and is ready only after a successful read", async t => {
  const h = await harness(t, () => page("100")); h.track("a", "@researcher");
  assert.equal((await h.service.readTwitterApiStatus("owner-a")).state,"configured");
  await h.service.refreshTwitterApi("owner-a");
  assert.equal(h.requests[0].searchParams.get("queryType"),"Latest");
  assert.match(h.requests[0].searchParams.get("query"),/from:researcher -filter:retweets.*since_time:\d+ until_time:\d+/);
  assert.ok(!h.requests[0].toString().includes("fixture-token"));
  assert.ok(!h.requests[0].searchParams.has("since_id"));
  const post=h.sql.prepare("SELECT * FROM signals").get(); assert.equal(post.source,"researcher"); assert.equal(post.url,"https://x.com/i/web/status/100");
  assert.equal((await h.service.readTwitterApiStatus("owner-a")).state,"ready");
  assert.equal((await h.service.refreshTwitterApi("owner-a")).checked,0);
});
test("fixed time window paginates short pages and deduplicates overlapping IDs", async t => {
  const h=await harness(t,(_url,n)=>page(n===1?"200":"100",n===1,"next-page"));h.track("a","pump.fun -is:retweet");
  await h.service.refreshTwitterApi("owner-a");
  const first=await h.core.setting("owner-a","twitterapi_track_a");assert.equal(first.completedUntil,undefined);
  h.advance(120001);await h.service.refreshTwitterApi("owner-a");
  assert.equal(h.requests[1].searchParams.get("query"),h.requests[0].searchParams.get("query"));assert.equal(h.requests[1].searchParams.get("cursor"),"next-page");
  const done=await h.core.setting("owner-a","twitterapi_track_a");assert.equal(done.completedUntil,first.end);assert.equal(done.nextToken,undefined);
  h.advance(120001);await h.service.refreshTwitterApi("owner-a");
  assert.match(h.requests[2].searchParams.get("query"),new RegExp('since_time:'+(first.end-60)));
  assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM signals").get().n,2);
});
test("concurrent refreshes and shared credentials cannot burst the free rate limit", async t => {
  const h=await harness(t,()=>page("100"));h.track("a","first");h.track("b","second","owner-b");await h.core.setSecret("owner-b","twitterapi","fixture-token");
  const result=await Promise.allSettled([h.service.refreshTwitterApi("owner-a"),h.service.refreshTwitterApi("owner-a"),h.service.refreshTwitterApi("owner-b")]);
  assert.equal(h.requests.length,1); assert.ok(result.some(r=>r.status==='fulfilled'));
  assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM signals").get().n,1);
});
test("semantic errors, malformed dates, redirects and repeated cursors never advance checkpoints or leak provider text", async t => {
  const replies=[Response.json({status:'error',msg:'fixture-token'}),Response.json({tweets:[{id:'100',text:'bad date',createdAt:'not-date'}],has_next_page:false}),new Response('fixture-token',{status:307,headers:{Location:'https://other.test'}}),page('100',true,'same')];
  const h=await harness(t,()=>replies.shift());h.track('a','research');
  await h.core.setSetting('owner-a','twitterapi_track_a',{query:'research',completedUntil:100,start:40,end:200,nextToken:'same'});
  for(let i=0;i<4;i++){
    await assert.rejects(h.service.refreshTwitterApi('owner-a'),e=>!e.message.includes('fixture-token'));
    const state=await h.core.setting('owner-a','twitterapi_track_a');assert.equal(state.completedUntil,100);assert.equal(state.nextToken,i===3?undefined:'same');assert.equal(state.end,200);
    h.advance(120001);
  }
  assert.equal(h.requests.length,4);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM signals').get().n,0);
});
test("one rejected query does not starve another tracker or mark it successfully checked",async t=>{
  const h=await harness(t,(url)=>url.searchParams.get('query').includes('bad')?new Response('',{status:400}):page('100'));h.track('a','bad');h.track('b','good');
  await assert.rejects(h.service.refreshTwitterApi('owner-a'));h.advance(5101);await h.service.refreshTwitterApi('owner-a');
  assert.equal(h.requests.length,2);assert.match(h.requests[1].searchParams.get('query'),/good/);
  assert.equal(h.sql.prepare("SELECT last_checked FROM tracks WHERE id='a'").get().last_checked,null);
  assert.equal((await h.service.readTwitterApiStatus('owner-a')).state,'partial');
});
test("provider HTTP-date retry window is shared by owners using the same key",async t=>{
  const h=await harness(t,(_url,n,clock)=>n===1?new Response('',{status:429,headers:{'retry-after':new Date(clock+300000).toUTCString()}}):page('100'));h.track('a','research');h.track('b','research','owner-b');await h.core.setSecret('owner-b','twitterapi','fixture-token');
  await assert.rejects(h.service.refreshTwitterApi('owner-a'));h.advance(6000);await assert.rejects(h.service.refreshTwitterApi('owner-b'));assert.equal(h.requests.length,1);
  h.advance(300000);await h.service.refreshTwitterApi('owner-b');assert.equal(h.requests.length,2);
});
test("empty intermediate pages preserve pagination and nested custom time operators are rejected",async t=>{
  const h=await harness(t,(_url,n)=>n===1?Response.json({tweets:[],has_next_page:true,next_cursor:'empty-next'}):page('100',false,'leftover'));h.track('a','research');await h.service.refreshTwitterApi('owner-a');h.advance(120001);await h.service.refreshTwitterApi('owner-a');
  assert.equal(h.requests[1].searchParams.get('cursor'),'empty-next');assert.equal((await h.core.setting('owner-a','twitterapi_track_a')).nextToken,undefined);
  h.track('b','topic (since_time:123)');h.advance(120001);await assert.rejects(h.service.refreshTwitterApi('owner-a'));assert.equal(h.requests.length,2);
});
test("empty results complete the time window and key replacement preserves history",async t=>{
  const h=await harness(t,()=>Response.json({tweets:[],has_next_page:false,next_cursor:''}));h.track('a','research');
  assert.equal((await h.service.refreshTwitterApi('owner-a')).saved,0);
  const before=await h.core.setting('owner-a','twitterapi_track_a');assert.ok(before.completedUntil);
  await h.service.resetTwitterApiStatus('owner-a');const after=await h.core.setting('owner-a','twitterapi_track_a');assert.equal(after.completedUntil,before.completedUntil);
  assert.equal((await h.service.readTwitterApiStatus('owner-a')).state,'configured');
});
test("failed saves do not advance the cursor and the next safe retry deduplicates posts",async t=>{
  const h=await harness(t,()=>page('100'));h.track('a','research');
  h.sql.exec("CREATE TRIGGER reject_signal BEFORE INSERT ON signals BEGIN SELECT RAISE(FAIL,'fixture database failure'); END;");
  await assert.rejects(h.service.refreshTwitterApi('owner-a'));assert.equal((await h.core.setting('owner-a','twitterapi_track_a')).completedUntil,undefined);
  h.sql.exec('DROP TRIGGER reject_signal');h.advance(120001);await h.service.refreshTwitterApi('owner-a');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM signals').get().n,1);
});
