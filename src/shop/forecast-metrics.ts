type Pair = { actual: number; predicted: number };
export function metrics(pairs: Pair[]) {
  const n = pairs.length;
  const actual = pairs.reduce((s, p) => s + p.actual, 0);
  const absolute = pairs.reduce(
    (s, p) => s + Math.abs(p.predicted - p.actual),
    0,
  );
  const nonzero = pairs.filter((p) => p.actual > 0);
  return {
    samples: n,
    mae: n ? absolute / n : null,
    rmse: n
      ? Math.sqrt(
          pairs.reduce((s, p) => s + (p.predicted - p.actual) ** 2, 0) / n,
        )
      : null,
    wape: actual > 0 ? (absolute / actual) * 100 : null,
    mape: nonzero.length
      ? (nonzero.reduce(
          (s, p) => s + Math.abs((p.predicted - p.actual) / p.actual),
          0,
        ) /
          nonzero.length) *
        100
      : null,
    bias: n ? pairs.reduce((s, p) => s + p.predicted - p.actual, 0) / n : null,
    zero_actual_samples: n - nonzero.length,
  };
}
