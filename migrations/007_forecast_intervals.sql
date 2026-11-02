-- The supplied XGBoost model has point predictions, not calibrated intervals.
ALTER TABLE forecasts ALTER COLUMN lower_qty DROP NOT NULL;
ALTER TABLE forecasts ALTER COLUMN upper_qty DROP NOT NULL;
ALTER TABLE forecasts ADD CONSTRAINT forecast_interval_pair
CHECK ((lower_qty IS NULL) = (upper_qty IS NULL));
ALTER TABLE forecasts ADD COLUMN history_source text NOT NULL DEFAULT 'unknown'
CHECK (history_source IN ('actual','demo','mixed','unknown'));

-- Do not invent zero-sales days before a menu was known to exist. Existing
-- menus use their earliest recorded history; new menus start today.
ALTER TABLE products ADD COLUMN forecast_since date NOT NULL
DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok')::date);
UPDATE products p SET forecast_since=s.since
FROM (SELECT product_id,min(date) AS since FROM sales_daily GROUP BY product_id) s
WHERE s.product_id=p.id AND s.since<p.forecast_since;
