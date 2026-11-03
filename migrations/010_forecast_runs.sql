CREATE TABLE forecast_runs (
 id uuid PRIMARY KEY,
 generated_at timestamptz NOT NULL,
 date_from date NOT NULL,
 date_to date NOT NULL CHECK(date_to >= date_from),
 data_mode text NOT NULL CHECK(data_mode IN ('actual','mixed')),
 target_basis text NOT NULL CHECK(target_basis='fulfilled_v1'),
 history_sha256 text NOT NULL CHECK(history_sha256 ~ '^[a-f0-9]{64}$'),
 input_history jsonb NOT NULL,
 created_by uuid REFERENCES users(id)
);
CREATE INDEX forecast_runs_time_idx ON forecast_runs(generated_at DESC,id);
CREATE TABLE forecast_run_points (
 run_id uuid NOT NULL REFERENCES forecast_runs(id),
 forecast_date date NOT NULL,
 product_id uuid NOT NULL REFERENCES products(id),
 predicted_qty numeric(12,3) NOT NULL CHECK(predicted_qty >= 0),
 lower_qty numeric(12,3),
 upper_qty numeric(12,3),
 CHECK ((lower_qty IS NULL AND upper_qty IS NULL) OR (lower_qty>=0 AND lower_qty<=predicted_qty AND upper_qty>=predicted_qty)),
 CHECK ((lower_qty IS NULL) = (upper_qty IS NULL)),
 model_version text NOT NULL,
 history_source text NOT NULL CHECK(history_source IN ('actual','demo','mixed','unknown')),
 lead_days integer NOT NULL CHECK(lead_days BETWEEN 1 AND 30),
 diagnostics jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(run_id,forecast_date,product_id)
);
CREATE INDEX forecast_run_points_date_idx ON forecast_run_points(forecast_date,product_id,lead_days);
CREATE INDEX orders_completed_demand_idx ON orders(completed_at) WHERE completed_at IS NOT NULL;
CREATE FUNCTION protect_forecast_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Forecast archive is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER forecast_runs_immutable BEFORE UPDATE OR DELETE ON forecast_runs FOR EACH ROW EXECUTE FUNCTION protect_forecast_archive();
CREATE TRIGGER forecast_points_immutable BEFORE UPDATE OR DELETE ON forecast_run_points FOR EACH ROW EXECUTE FUNCTION protect_forecast_archive();
