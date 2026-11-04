type Observation = { date: string; product_id: string; qty: number };
export type ReplayBaseline = { date: string; product_id: string; predicted_qty: number };

// Repeat the most recent observed matching weekday, frozen at this origin.
// Missing matching weekdays fall back to the observed prior 28-day mean.
export function replayBaseline(history: Observation[], cutoff: string, days: number): ReplayBaseline[] {
  const prior = history.filter(r => r.date < cutoff).sort((a, b) => a.date.localeCompare(b.date));
  return [...new Set(prior.map(r => r.product_id))].flatMap(product_id => {
    const series = prior.filter(r => r.product_id === product_id);
    const recent = series.filter(r => Date.parse(r.date) >= Date.parse(cutoff) - 28 * 86400000);
    const fallback = recent.length ? recent : series;
    return Array.from({ length: days }, (_, i) => {
      const date = new Date(Date.parse(cutoff) + i * 86400000).toISOString().slice(0, 10);
      const match = series.filter(r => new Date(r.date).getUTCDay() === new Date(date).getUTCDay()).at(-1);
      return { date, product_id, predicted_qty: match?.qty ?? fallback.reduce((s, r) => s + r.qty, 0) / fallback.length };
    });
  });
}
