import assert from "node:assert/strict";
const root = "http://127.0.0.1:5173";
async function request(path, options = {}) {
  const r = await fetch(root + path, options);
  let data;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data };
}
const headers = {
  "content-type": "application/json",
  cookie: "__sites_local_auth=1",
  origin: root,
};
assert.equal((await request("/api/dev")).status, 401);
assert.equal(
  (
    await request("/api/dev", {
      headers: {
        "oai-authenticated-user-id": "forged",
        "oai-authenticated-user-email": "forged@example.test",
      },
    })
  ).status,
  401,
);
const state = await request("/api/dev", { headers });
assert.equal(state.status, 200, JSON.stringify(state.data));
assert(
  state.data.wallets.some(
    (w) => w.query === "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa",
  ),
);
const models = await request("/api/models");
assert.equal(models.status, 200);
assert(models.data.models.length > 10);
const post = (body) =>
  request("/api/dev", { method: "POST", headers, body: JSON.stringify(body) });
assert.equal(
  (
    await request("/api/dev", {
      method: "POST",
      headers: { ...headers, origin: "https://attacker.example" },
      body: '{"action":"add_track","query":"test"}',
    })
  ).status,
  403,
);
assert.equal(
  (await post({ action: "add_wallet", query: "invalid" })).status,
  400,
);
assert.equal(
  (
    await post({
      action: "save_support",
      mint: "",
      treasury: "",
      percentage: 101,
    })
  ).status,
  400,
);
const created = await post({
  action: "create_agent",
  name: "QA temporary dev",
  mission: "Test persistence only; do not launch coins.",
  model: models.data.models[0].id,
});
assert.equal(created.status, 200, JSON.stringify(created.data));
const saved = await request("/api/dev", { headers });
assert(saved.data.agents.some((a) => a.id === created.data.id));
// Missing-access checks must never turn into paid runs after credentials are connected.
if (!saved.data.connections.openrouter && !saved.data.aiAccess?.available) {
  const run = await request("/api/run", {
    method: "POST",
    headers,
    body: JSON.stringify({ agentId: created.data.id }),
  });
  assert.equal(run.status, 403);
  assert.match(run.data.error, /Connect OpenRouter/i);
}
console.log(
  JSON.stringify({
    passed: 8,
    models: models.data.models.length,
    testAgent: created.data.id,
  }),
);
