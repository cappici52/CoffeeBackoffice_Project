import { test } from "node:test";
import assert from "node:assert/strict";
import {
  random,
  demand,
  sandboxUrl,
  weeklyPrediction,
} from "./simulation-plan.mjs";

test("synthetic demand repeats with the declared seed and remains integer nonnegative", () => {
  const a = random(),
    b = random();
  for (let day = 0; day < 211; day++) {
    const values = demand("2026-11-02", day, a);
    assert.deepEqual(values, demand("2026-11-02", day, b));
    assert(values.every((value) => Number.isInteger(value) && value >= 0));
  }
});
test("sandbox targeting refuses arbitrary, remote and source database names", () => {
  const name = "coffee_sim_20261103000000_1234abcd";
  assert.throws(() => sandboxUrl("postgresql://localhost/live", "live"));
  assert.throws(() => sandboxUrl("postgresql://remote.example/live", name));
  assert.throws(() => sandboxUrl("postgresql://localhost/" + name, name));
  const url = new URL(
    sandboxUrl("postgresql://localhost/live?options=unsafe", name),
  );
  assert.equal(url.pathname, "/" + name);
  assert.equal(
    url.searchParams.get("options"),
    "-csearch_path=public,pg_catalog -csynchronous_commit=off",
  );
});
test("weekly baseline bridges the issue-day gap without using held-out targets", () => {
  const history = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-10-${String(20 + i).padStart(2, "0")}`,
    qty: i + 1,
  }));
  assert.equal(weeklyPrediction(history, "2026-10-28"), 2);
  assert.equal(weeklyPrediction(history, "2026-11-04"), 2);
  assert.throws(() => weeklyPrediction(history, "2026-10-26"));
});
