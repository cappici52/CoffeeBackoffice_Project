type Quantity = { date: string; product_id: string; qty: number | string };
export function forecastSummary(
  tomorrow: string,
  predictions: Quantity[],
  history: Quantity[],
) {
  const ids = [...new Set(predictions.map((p) => p.product_id))];
  const next = predictions.filter((p) => p.date === tomorrow);
  const tomorrowQty =
    ids.length && new Set(next.map((p) => p.product_id)).size === ids.length
      ? next.reduce((s, p) => s + Number(p.qty), 0)
      : null;
  // Require seven complete, immediately preceding business days, never fill gaps.
  const totals: number[] = [];
  for (let offset = 2; offset <= 8; offset++) {
    const day = new Date(Date.parse(tomorrow) - offset * 86400000)
      .toISOString()
      .slice(0, 10);
    const rows = history.filter(
      (p) => p.date === day && ids.includes(p.product_id),
    );
    if (
      ids.length &&
      new Set(rows.map((p) => p.product_id)).size === ids.length
    )
      totals.push(rows.reduce((s, p) => s + Number(p.qty), 0));
  }
  const average =
    totals.length === 7 ? totals.reduce((s, q) => s + q, 0) / 7 : null;
  return {
    tomorrow: tomorrowQty,
    seven_day_average: average,
    change_percent:
      tomorrowQty !== null && average !== null && average > 0
        ? ((tomorrowQty - average) / average) * 100
        : null,
  };
}
