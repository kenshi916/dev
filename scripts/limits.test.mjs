import assert from "node:assert/strict";
import test from "node:test";
import { simulatedDebit } from "../app/server/limits.ts";
test("budget uses a single simulation balance pair, including account rent", () => {
  assert.equal(
    simulatedDebit({
      preBalances: [100000000],
      postBalances: [87000000],
      err: null,
    }),
    13000000,
  );
  // A concurrent deposit before simulation must not reduce reserved cost.
  assert.equal(
    simulatedDebit({
      preBalances: [200000000],
      postBalances: [187000000],
      err: null,
    }),
    13000000,
  );
});
test("missing or invalid cost data fails closed", () => {
  for (const input of [
    {},
    { err: "failed", preBalances: [9], postBalances: [2] },
    { preBalances: [2], postBalances: [9] },
    { preBalances: [Infinity], postBalances: [0] },
    { preBalances: [9.1], postBalances: [0] },
  ])
    assert.throws(() => simulatedDebit(input));
});
