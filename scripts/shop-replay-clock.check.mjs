import { test } from "node:test";
import assert from "node:assert/strict";
import { replayQuery } from "./shop-replay-clock.mjs";
const time = "2026-05-01T02:00:00.000Z",
  run = "00000000-0000-4000-8000-000000000001";
test("replay stamps only new order event time and provenance; parameters remain intact", () => {
  const q = replayQuery(
    "INSERT INTO orders (id,note) VALUES ($1,$2)",
    ["id", "literal now()"],
    time,
    run,
  );
  assert.deepEqual(q.values, ["id", "literal now()", run]);
  assert(q.text.includes("simulation_run_id,created_at"));
  assert(q.text.includes("$3"));
});
test("stock ingestion time is real while payment event time is replayed", () => {
  assert(
    !replayQuery(
      "INSERT INTO stock_movements (id) VALUES ($1)",
      ["id"],
      time,
      run,
    ).text.includes("created_at"),
  );
  assert(
    replayQuery(
      "INSERT INTO payments (order_id) VALUES ($1)",
      ["id"],
      time,
      run,
    ).text.includes("paid_at"),
  );
  assert(
    replayQuery(
      "UPDATE orders SET confirmed_at=now() WHERE id=$1",
      ["id"],
      time,
      run,
    ).text.includes(time),
  );
});
test("unexpected insert shapes and unsafe clock values fail closed", () => {
  assert.throws(() =>
    replayQuery("INSERT INTO orders SELECT * FROM orders", [], time, run),
  );
  assert.throws(() => replayQuery("SELECT now()", [], "bad' SQL", run));
  assert.throws(() => replayQuery("SELECT now()", [], time, "bad"));
});
