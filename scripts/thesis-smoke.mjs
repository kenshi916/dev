import assert from "node:assert/strict";

const base = "http://127.0.0.1:5173";
const headers = {
  "content-type": "application/json",
  cookie: "__sites_local_auth=1",
  origin: base,
};
const post = (data, extra = {}) =>
  fetch(base + "/api/thesis", {
    method: "POST",
    headers: { ...headers, ...extra },
    body: JSON.stringify(data),
  });
assert.equal((await fetch(base + "/api/thesis")).status, 401);
const stored = await fetch(base + "/api/thesis", { headers });
assert.equal(stored.status, 200);
assert.ok("discussion" in (await stored.json()));
assert.equal(
  (
    await post(
      { topic: "community robots", model: "openai/example" },
      { origin: "https://attacker.example" },
    )
  ).status,
  403,
);
assert.equal((await post({ topic: "a", model: "openai/example" })).status, 400);
assert.equal(
  (await post({ topic: "community robots", agentIds: ["same", "same"] }))
    .status,
  400,
);
const state = await (await fetch(base + "/api/dev", { headers })).json();
if (!state.connections.openrouter && !state.aiAccess?.available) {
  const missing = await post({
    topic: "community robots",
    model: "openai/example",
  });
  assert.equal(missing.status, 403);
  assert.match((await missing.json()).error, /Connect openrouter/i);
}
const catalog = await (await fetch(base + "/api/models")).json();
assert.ok(catalog.models.length > 10);
for (const provider of ["anthropic", "openai", "google", "deepseek", "qwen"]) {
  const model = catalog.models.find((m) => m.provider === provider);
  assert.ok(model?.iconUrl.startsWith("/model-icons/"));
  const icon = await fetch(base + model.iconUrl);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get("content-type"), /image\//);
}
console.log(
  "Thesis route auth, CSRF, validation, credential gating, saved state, and provider artwork passed. No model calls or launches made.",
);
