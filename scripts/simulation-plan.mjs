// Synthetic demand only. No production data or model predictions are inputs.
export function random(seed = 20261103) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function poisson(mean, next) {
  const limit = Math.exp(-mean);
  let product = 1,
    count = 0;
  do {
    count++;
    product *= next();
  } while (product > limit);
  return count - 1;
}

export function dateOffset(date, days) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

export function demand(day, index, next) {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  // Slow growth, common daily noise and an occasional event, declared in advance.
  const multiplier =
    (weekend ? 1.35 : 1) *
    (1 + index * 0.0008) *
    (0.75 + next() * 0.5) *
    (index % 41 === 20 ? 1.7 : 1);
  return [9, 8, 6, 4, 7, 5, 6, 4].map((mean) =>
    poisson(mean * multiplier, next),
  );
}

export function sandboxUrl(source, name) {
  if (!/^coffee_sim_[0-9]{14}_[a-f0-9]{8}$/.test(name))
    throw new Error("Invalid generated sandbox name");
  const url = new URL(source);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Simulation requires local PostgreSQL");
  if (decodeURIComponent(url.pathname.slice(1)) === name)
    throw new Error("Source must differ from sandbox");
  url.pathname = "/" + name;
  url.search = "";
  // Disposable sandbox only: avoid waiting for disk flush on every synthetic sale.
  url.searchParams.set(
    "options",
    "-csearch_path=public,pg_catalog -csynchronous_commit=off",
  );
  return url.toString();
}

export function weeklyPrediction(history, target) {
  const origin = history.at(-1).date;
  const offset = (Date.parse(target) - Date.parse(origin)) / 86400000;
  if (offset < 1)
    throw new Error("Evaluation target must follow training history");
  return history.at(-7 + ((offset - 1) % 7)).qty;
}
