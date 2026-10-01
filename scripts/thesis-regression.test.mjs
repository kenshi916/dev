import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const project = new URL("../", import.meta.url);
const proposal = {
  name: "Research Owl",
  symbol: "ROWL",
  description: "An original community concept for careful researchers.",
  thesis: "A community centered on careful and transparent research.",
  differentiation:
    "A playful owl identity with public source-based discussions.",
  pairing: {
    type: "narrative",
    candidate: "Research communities",
    reason: "A shared interest in checking evidence before acting.",
  },
  risks: [
    "The available market sample is small.",
    "Community interest is unverified.",
  ],
};
const previous = {
  id: "previous-discussion",
  status: "complete",
  topic: "research culture",
  createdAt: "2026-09-29T12:00:00.000Z",
  models: ["fixture/model"],
  messages: [
    {
      role: "analyst",
      content: "Earlier public conclusions are unverified.",
      sourceIds: ["old-signal"],
    },
  ],
  proposal: { ...proposal, novelty: "Unverified", quoteAsset: "SOL" },
  sources: [],
};

function compile(path, dependencies, fetch) {
  const filename = fileURLToPath(new URL(path, project));
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module: evaluatedModule,
      exports: evaluatedModule.exports,
      require(name) {
        if (name in dependencies) return dependencies[name];
        throw new Error("Unexpected module or transaction access: " + name);
      },
      fetch,
      Request,
      Response,
      Headers,
      TextEncoder,
      TextDecoder,
      URL,
      ReadableStream,
      AbortController,
      AbortSignal,
      crypto: globalThis.crypto,
      Uint8Array,
      Buffer,
      btoa,
      atob,
    },
    { filename },
  );
  return evaluatedModule.exports;
}

async function harness(t, options = {}) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(new URL("drizzle/0000_broad_apocalypse.sql", project), "utf8"),
  );
  t.after(() => sql.close());
  const requests = [];
  let owner = "owner-a";
  const database = {
    prepare(query) {
      const statement = sql.prepare(query);
      const bound = (...args) => ({
        bind: (...values) => bound(...values),
        async run() {
          return { meta: { changes: Number(statement.run(...args).changes) } };
        },
        async first() {
          return statement.get(...args) || null;
        },
        async all() {
          return { results: statement.all(...args) };
        },
      });
      return bound();
    },
  };
  const fetch = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    const address = new URL(url);
    if (address.href.startsWith("https://openrouter.ai/api/v1/models"))
      return Response.json({
        data: ["fixture/model", "fixture/other"].map((id) => ({
          id,
          supported_parameters: ["tools", "response_format"],
        })),
      });
    if (address.hostname === "api.dexscreener.com") {
      const name = options.marketName || "Existing Sample";
      return Response.json({
        pairs: [
          {
            chainId: "solana",
            dexId: "pumpfun",
            pairAddress: "sample-pair",
            baseToken: { name, symbol: "EXAMPLE" },
            quoteToken: { symbol: "SOL" },
            url: "https://dexscreener.com/solana/sample-pair",
            priceUsd: "0.1",
            liquidity: { usd: 1000 },
            volume: { h24: 20 },
            priceChange: { h24: 2 },
            pairCreatedAt: 1700000000000,
          },
        ],
      });
    }
    if (address.href === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(init.body);
      requests.push(body);
      const context = JSON.parse(body.messages[1].content);
      const index = context.publicDiscussion.length;
      if (options.failTurn === index)
        return new Response("Provider unavailable", { status: 503 });
      if (index === 2) options.beforeEditor?.(sql);
      const value = {
        content:
          "A public conclusion with explicit uncertainty and evidence limits.",
        sourceIds: options.forgedCitation
          ? ["not-in-current-evidence"]
          : [context.research.sources[0].id],
        ...(index === 2
          ? { proposal: { ...proposal, ...(options.proposal || {}) } }
          : {}),
      };
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify(value),
              reasoning: "This must never enter the public result.",
            },
          },
        ],
      });
    }
    throw new Error(
      "Unexpected network or transaction access: " + address.href,
    );
  };
  const core = compile(
    "app/server/core.ts",
    {
      "cloudflare:workers": {
        env: {
          DB: database,
          CREDENTIAL_SECRET: "fixture-only-encryption-secret-32-characters",
        },
      },
      "../chatgpt-auth": { getChatGPTUser: async () => ({ userId: owner }) },
    },
    fetch,
  );
  const access = compile(
    "app/server/ai-access.ts",
    {
      "./core": core,
      "cloudflare:workers": { env: { DB: database } },
    },
    fetch,
  );
  const service = compile(
    "app/server/thesis.ts",
    { "./core": core, "./ai-access": access, zod: require("zod") },
    fetch,
  );
  const route = compile(
    "app/api/thesis/route.ts",
    {
      "../../server/core": core,
      "../../server/thesis": service,
    },
    fetch,
  );
  await core.setSecret(
    owner,
    "openrouter",
    "fixture-key-never-sent-to-a-provider",
  );
  return {
    sql,
    requests,
    core,
    service,
    route,
    setOwner(value) {
      owner = value;
    },
  };
}

test("persists exactly three bounded public roles with fresh source attribution", async (t) => {
  const h = await harness(t);
  h.sql
    .prepare(
      "INSERT INTO signals (id,owner,kind,source,text,created_at,url,likes) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      "saved-tweet",
      "owner-a",
      "tweet",
      "researcher",
      "A saved research observation",
      "2026-09-20T00:00:00.000Z",
      "https://x.com/researcher/status/1",
      0,
    );
  const session = await h.service.prepareThesis("owner-a", {
    topic: "research culture",
    model: "fixture/model",
  });
  const events = [];
  const discussion = await session.run((event) => events.push(event));
  assert.equal(discussion.status, "complete");
  assert.equal(discussion.messages.length, 3);
  assert.equal(h.requests.length, 3);
  for (const request of h.requests) {
    assert.equal(request.max_tokens, 1200);
    assert.equal(request.reasoning.exclude, true);
    assert.equal(request.tools, undefined);
  }
  assert.equal(events.filter((event) => event.type === "message").length, 3);
  assert.equal(discussion.coverage.signalsRefreshed, false);
  assert.equal(
    discussion.coverage.newestSavedSignalAt,
    "2026-09-20T00:00:00.000Z",
  );
  assert.equal(discussion.proposal.quoteAsset, "SOL");
  assert.ok(!JSON.stringify(discussion).includes("This must never enter"));
  assert.equal((await h.service.latestThesis("owner-a")).id, discussion.id);
  assert.equal(await h.service.latestThesis("owner-b"), null);
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM drafts").get().n, 0);
});

test("concurrent preflights acquire only one owner lease", async (t) => {
  const h = await harness(t);
  const attempts = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      h.service.prepareThesis("owner-a", {
        topic: "research culture",
        model: "fixture/model",
      }),
    ),
  );
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
  );
  assert.equal(
    attempts.find((attempt) => attempt.status === "rejected").reason.status,
    429,
  );
  await attempts.find((attempt) => attempt.status === "fulfilled").value.run();
  assert.equal(h.requests.length, 3);
});

test("owned agent missions are snapshotted and unknown agents or models are rejected", async (t) => {
  const h = await harness(t);
  for (let i = 1; i <= 3; i++)
    h.sql
      .prepare(
        "INSERT INTO agents (id,owner,name,mission,model,status,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        "agent-" + i,
        "owner-a",
        "Dev " + i,
        "Mission " + i,
        i === 2 ? "fixture/other" : "fixture/model",
        "ready",
        new Date().toISOString(),
      );
  await assert.rejects(
    h.service.prepareThesis("owner-a", {
      topic: "research culture",
      agentIds: ["foreign-agent"],
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    h.service.prepareThesis("owner-a", {
      topic: "research culture",
      model: "missing/model",
    }),
    (error) => error.status === 400,
  );
  const session = await h.service.prepareThesis("owner-a", {
    topic: "research culture",
    agentIds: ["agent-3", "agent-1", "agent-2"],
  });
  h.sql.prepare("UPDATE agents SET mission='Changed after preflight'").run();
  const discussion = await session.run();
  assert.equal(discussion.messages[0].name, "Dev 3");
  assert.equal(discussion.messages[2].model, "fixture/other");
  assert.equal(
    JSON.parse(h.requests[0].messages[1].content).participantPreferences,
    "Mission 3",
  );
});

test("failed roles preserve latest and release the exact lease", async (t) => {
  const h = await harness(t, { failTurn: 1 });
  await h.core.setSetting("owner-a", "thesis_latest", previous);
  const session = await h.service.prepareThesis("owner-a", {
    topic: "research culture",
    model: "fixture/model",
  });
  await assert.rejects(session.run(), (error) => error.status === 502);
  assert.equal((await h.service.latestThesis("owner-a")).id, previous.id);
  assert.equal((await h.core.setting("owner-a", "thesis_lock")).busyUntil, 0);
  assert.equal(h.requests.length, 2);
});

test("continuations require matching owner, latest ID and topic, without stale citation IDs", async (t) => {
  const h = await harness(t);
  await h.core.setSetting("owner-a", "thesis_latest", previous);
  for (const input of [
    { topic: "a different topic", previousDiscussionId: previous.id },
    { topic: previous.topic, previousDiscussionId: "stale-discussion" },
  ])
    await assert.rejects(
      h.service.prepareThesis("owner-a", { ...input, model: "fixture/model" }),
      (error) => error.status === 409,
    );
  await h.core.setSecret("owner-b", "openrouter", "fixture-key");
  await assert.rejects(
    h.service.prepareThesis("owner-b", {
      topic: previous.topic,
      previousDiscussionId: previous.id,
      model: "fixture/model",
    }),
    (error) => error.status === 409,
  );
  const session = await h.service.prepareThesis("owner-a", {
    topic: previous.topic,
    previousDiscussionId: previous.id,
    model: "fixture/model",
  });
  await session.run();
  const context = JSON.parse(h.requests[0].messages[1].content);
  assert.equal(
    context.research.previousRound.proposal.name,
    previous.proposal.name,
  );
  assert.ok(
    !JSON.stringify(context.research.previousRound).includes("old-signal"),
  );
});

test("unsupported citations fail closed and cancellation preserves completed discussion", async (t) => {
  const h = await harness(t, { forgedCitation: true });
  await h.core.setSetting("owner-a", "thesis_latest", previous);
  let session = await h.service.prepareThesis("owner-a", {
    topic: previous.topic,
    model: "fixture/model",
  });
  await assert.rejects(session.run(), (error) => error.status === 502);
  assert.equal((await h.service.latestThesis("owner-a")).id, previous.id);
  await h.core.setSetting("owner-a", "thesis_lock", {
    busyUntil: 0,
    nextAllowedAt: 0,
  });
  session = await h.service.prepareThesis("owner-a", {
    topic: previous.topic,
    model: "fixture/model",
  });
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(
    session.run(undefined, cancel.signal),
    (error) => error.status === 504,
  );
  assert.equal((await h.service.latestThesis("owner-a")).id, previous.id);
});

test("NDJSON streams actual completed messages followed by a bounded error", async (t) => {
  const h = await harness(t, { failTurn: 1 });
  const response = await h.route.POST(
    new Request("https://dev.example/api/thesis", {
      method: "POST",
      headers: {
        origin: "https://dev.example",
        accept: "application/x-ndjson",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "research culture",
        model: "fixture/model",
      }),
    }),
  );
  assert.equal(response.status, 200);
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.type === "status"));
  assert.equal(events.filter((event) => event.type === "message").length, 1);
  assert.equal(events.filter((event) => event.type === "result").length, 0);
  assert.equal(events.at(-1).type, "error");
  assert.equal(await h.service.latestThesis("owner-a"), null);
});

test("distinct non-Latin names are not falsely marked as matching", async (t) => {
  const h = await harness(t, {
    marketName: "猫咪",
    proposal: { name: "月亮" },
  });
  const session = await h.service.prepareThesis("owner-a", {
    topic: "research culture",
    model: "fixture/model",
  });
  const discussion = await session.run();
  assert.equal(discussion.coverage.noveltyStatus, "not_found_in_sample");
});

test("a superseded lease cannot replace latest or unlock a newer discussion", async (t) => {
  const nextLock = JSON.stringify({
    token: "newer-lease",
    busyUntil: Date.now() + 190000,
    nextAllowedAt: Date.now() + 60000,
  });
  const h = await harness(t, {
    beforeEditor(sql) {
      sql
        .prepare(
          "UPDATE settings SET value=? WHERE owner=? AND key='thesis_lock'",
        )
        .run(nextLock, "owner-a");
    },
  });
  await h.core.setSetting("owner-a", "thesis_latest", previous);
  const session = await h.service.prepareThesis("owner-a", {
    topic: previous.topic,
    model: "fixture/model",
  });
  await assert.rejects(session.run(), (error) => error.status === 409);
  assert.equal((await h.service.latestThesis("owner-a")).id, previous.id);
  assert.equal(
    h.sql
      .prepare("SELECT value FROM settings WHERE owner=? AND key='thesis_lock'")
      .get("owner-a").value,
    nextLock,
  );
});
