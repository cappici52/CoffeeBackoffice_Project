// Replay-only adapter. Normal server SQL, database defaults and OS time stay unchanged.
const stamped = new Map([
  ["orders", "created_at"],
  ["payments", "paid_at"],
  ["stock_movements", null],
  ["day_closings", null],
  ["forecast_runs", null],
]);

export function replayQuery(text, values, instant, runId) {
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(instant) ||
    !/^[a-f0-9-]{36}$/.test(runId)
  )
    throw new Error("Invalid replay context");
  const literal = `'${instant}'::timestamptz`;
  let sql = text.replace(/\bnow\(\)/gi, literal);
  const table = sql.match(/^INSERT INTO (\w+)(?:\s|\()/)?.[1];
  const args = [...(values ?? [])];
  if (stamped.has(table)) {
    // Whitelist the application's simple parameterized inserts; fail on changed SQL.
    const match = sql.match(
      /^INSERT INTO (\w+)\s*\(([^)]+)\) VALUES\s*\(([^)]+)\)$/s,
    );
    if (!match || match[2].includes("simulation_run_id"))
      throw new Error("Unsupported replay insert shape");
    args.push(runId);
    const timestamp = stamped.get(table);
    sql = `INSERT INTO ${table} (${match[2]},simulation_run_id${timestamp ? "," + timestamp : ""}) VALUES (${match[3]},$${args.length}${timestamp ? "," + literal : ""})`;
  }
  if (table === "order_status_logs") {
    const match = sql.match(
      /^INSERT INTO order_status_logs \(([^)]+)\) VALUES \(([^)]+)\)$/s,
    );
    if (!match) throw new Error("Unsupported replay status insert");
    sql = `INSERT INTO order_status_logs (${match[1]},changed_at) VALUES (${match[2]},${literal})`;
  }
  return {
    text: sql,
    values: values === undefined && !args.length ? undefined : args,
  };
}

export function replayDatabase(db, getInstant, runId) {
  const adapter = (sql) => ({
    query(text, values) {
      const q = replayQuery(text, values, getInstant(), runId);
      return sql.query(q.text, q.values);
    },
  });
  return {
    ...adapter(db),
    transaction: (work) => db.transaction((sql) => work(adapter(sql))),
  };
}
