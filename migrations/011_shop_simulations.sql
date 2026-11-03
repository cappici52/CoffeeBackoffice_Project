CREATE TABLE shop_simulation_runs (
 id uuid PRIMARY KEY,
 date_from date NOT NULL,
 date_to date NOT NULL CHECK(date_to>=date_from),
 seed integer NOT NULL,
 status text NOT NULL CHECK(status IN ('running','complete','failed')),
 created_by uuid NOT NULL REFERENCES users(id),
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE shop_simulation_products (
 run_id uuid NOT NULL REFERENCES shop_simulation_runs(id),
 product_id uuid NOT NULL REFERENCES products(id),
 PRIMARY KEY(run_id,product_id)
);
ALTER TABLE orders ADD COLUMN simulation_run_id uuid REFERENCES shop_simulation_runs(id);
ALTER TABLE payments ADD COLUMN simulation_run_id uuid REFERENCES shop_simulation_runs(id);
ALTER TABLE stock_movements ADD COLUMN simulation_run_id uuid REFERENCES shop_simulation_runs(id);
ALTER TABLE day_closings ADD COLUMN simulation_run_id uuid REFERENCES shop_simulation_runs(id);
ALTER TABLE forecast_runs ADD COLUMN simulation_run_id uuid REFERENCES shop_simulation_runs(id);
ALTER TABLE forecast_runs ADD COLUMN contains_simulated_sales boolean NOT NULL DEFAULT false;
CREATE INDEX orders_simulation_idx ON orders(simulation_run_id) WHERE simulation_run_id IS NOT NULL;
CREATE INDEX stock_simulation_idx ON stock_movements(simulation_run_id) WHERE simulation_run_id IS NOT NULL;
