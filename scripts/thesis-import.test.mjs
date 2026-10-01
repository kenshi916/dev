import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const project = new URL("../", import.meta.url);
const fixture = {
  id: "cf3020ee-3d7c-465b-bddc-6cde57f0711c",
  status: "complete",
  topic: "A coherent original thesis",
  models: ["provider/analyst", "provider/editor"],
  sources: [
    { url: "https://x.com/example/status/123" },
    { url: "https://example.com/evidence" },
  ],
  proposal: {
    name: "Testing Thesis",
    symbol: "test",
    description: "A test proposal",
    thesis: "Original thesis",
    differentiation: "Distinct idea",
    novelty: "Limited market sample",
    quoteAsset: "SOL",
    pairing: {
      type: "narrative",
      candidate: "Community theme",
      reason: "Shared story",
    },
  },
};

function loadProductionModule(path, dependencies) {
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
        throw new Error("Unexpected module access: " + name);
      },
      fetch() {
        throw new Error("Network access is prohibited in import tests.");
      },
      Request,
      Response,
      Headers,
      TextEncoder,
      TextDecoder,
      URL,
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

function harness(t) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(new URL("drizzle/0000_broad_apocalypse.sql", project), "utf8"),
  );
  t.after(() => sql.close());
  let owner = "owner-a";
  let batchTail = Promise.resolve();
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
    batch(statements) {
      // D1 batches execute transactionally; serialize the in-memory equivalent.
      const operation = batchTail.then(async () => {
        sql.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements)
            results.push(await statement.run());
          sql.exec("COMMIT");
          return results;
        } catch (error) {
          sql.exec("ROLLBACK");
          throw error;
        }
      });
      batchTail = operation.catch(() => {});
      return operation;
    },
  };
  const core = loadProductionModule("app/server/core.ts", {
    "cloudflare:workers": { env: { DB: database } },
    "../chatgpt-auth": {
      getChatGPTUser: async () => (owner ? { userId: owner } : null),
    },
  });
  const route = loadProductionModule("app/api/dev/route.ts", {
    "../../server/core": core,
    "@solana/web3.js": { PublicKey: class {} },
    "../../server/signals": { TRACKED_WALLET: "unused-test-wallet" },
    "../../server/ai-access": {},
    "../../server/twitter": {}, "../../server/twitter-provider": {}, "../../server/twitterapi": {},
  });
  return {
    sql,
    setOwner(value) {
      owner = value;
    },
    save(value, forOwner = owner) {
      return core.setSetting(forOwner, "thesis_latest", value);
    },
    async post(action, values = {}) {
      const response = await route.POST(
        new Request("https://dev.example/api/dev", {
          method: "POST",
          headers: {
            origin: "https://dev.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ action, ...values }),
        }),
      );
      return { status: response.status, data: await response.json() };
    },
  };
}

test("imports persisted thesis provenance into a manual draft", async (t) => {
  const h = harness(t);
  await h.save(fixture);
  const response = await h.post("import_thesis", {
    discussionId: fixture.id,
    name: "Untrusted client override",
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.name, fixture.proposal.name);
  assert.equal(response.data.symbol, "TEST");
  assert.equal(response.data.status, "draft");
  for (const text of [
    fixture.proposal.thesis,
    fixture.proposal.differentiation,
    fixture.proposal.novelty,
    fixture.proposal.pairing.candidate,
    fixture.proposal.pairing.reason,
    ...fixture.sources.map((source) => source.url),
  ])
    assert.ok(response.data.rationale.includes(text));
  const agent = h.sql
    .prepare("SELECT * FROM agents WHERE id=?")
    .get(response.data.agent_id);
  assert.equal(agent.name, "Thesis studio");
  assert.equal(agent.model, "provider/editor");
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
});

test("concurrent retries create only one agent and one draft", async (t) => {
  const h = harness(t);
  await h.save(fixture);
  const responses = await Promise.all(
    Array.from({ length: 3 }, () =>
      h.post("import_thesis", { discussionId: fixture.id }),
    ),
  );
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.data.id, responses[0].data.id);
  }
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM agents").get().n, 1);
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM drafts").get().n, 1);
});

test("requires authentication, matching discussion, and completion", async (t) => {
  const h = harness(t);
  await h.save(fixture);
  assert.equal(
    (await h.post("import_thesis", { discussionId: "another-id" })).status,
    409,
  );
  await h.save({ ...fixture, status: "running" });
  assert.equal(
    (await h.post("import_thesis", { discussionId: fixture.id })).status,
    409,
  );
  h.setOwner(null);
  assert.equal(
    (await h.post("import_thesis", { discussionId: fixture.id })).status,
    401,
  );
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM drafts").get().n, 0);
});

test("isolates owners even when discussion identifiers match", async (t) => {
  const h = harness(t);
  await h.save(fixture);
  const first = await h.post("import_thesis", { discussionId: fixture.id });
  h.setOwner("owner-b");
  assert.equal(
    (await h.post("import_thesis", { discussionId: fixture.id })).status,
    409,
  );
  await h.save(fixture);
  const second = await h.post("import_thesis", { discussionId: fixture.id });
  assert.equal(second.status, 200);
  assert.notEqual(second.data.id, first.data.id);
  assert.notEqual(second.data.agent_id, first.data.agent_id);
});

test("terminal edits and repeated imports preserve reviewed content", async (t) => {
  const h = harness(t);
  await h.save(fixture);
  const first = await h.post("import_thesis", { discussionId: fixture.id });
  const edited = await h.post("save_studio_draft", {
    id: first.data.id,
    name: "Edited name",
    symbol: "EDIT",
    description: "Edited description",
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.rationale, first.data.rationale);
  const repeated = await h.post("import_thesis", { discussionId: fixture.id });
  assert.equal(repeated.data.name, "Edited name");
  assert.equal(repeated.data.rationale, first.data.rationale);
});

test("bounds rationale while retaining complete source links and SOL scope", async (t) => {
  const h = harness(t);
  await h.save({
    ...fixture,
    sources: Array.from({ length: 100 }, (_, i) => ({
      url: "https://example.com/source/" + i,
    })),
    proposal: {
      ...fixture.proposal,
      thesis: "t".repeat(5000),
      differentiation: "d".repeat(5000),
      novelty: "n".repeat(5000),
    },
  });
  const response = await h.post("import_thesis", { discussionId: fixture.id });
  assert.equal(response.status, 200);
  assert.ok(response.data.rationale.length <= 4000);
  assert.ok(response.data.rationale.includes("https://example.com/source/0"));
  assert.ok(response.data.rationale.includes("initial purchase: 0 SOL"));
  await h.save({
    ...fixture,
    proposal: { ...fixture.proposal, quoteAsset: "USDC" },
  });
  assert.equal(
    (await h.post("import_thesis", { discussionId: fixture.id })).status,
    400,
  );
});
