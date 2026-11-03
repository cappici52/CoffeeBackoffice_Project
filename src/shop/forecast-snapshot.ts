// A fixed property order survives PostgreSQL jsonb's object-key reordering.
// Export this exact UTF-8 string so users can verify its SHA-256 directly.
export function serializeForecastHistory(
  rows: {
    date: string;
    product_id: string;
    qty: number;
    unit_price: number;
    source: string;
  }[],
) {
  return JSON.stringify(
    rows.map((row) => ({
      date: row.date,
      product_id: row.product_id,
      qty: row.qty,
      unit_price: row.unit_price,
      source: row.source,
    })),
  );
}
