-- Research data never references operational products, orders or inventory.
CREATE TABLE research_datasets (
 id uuid PRIMARY KEY,
 content_sha256 text NOT NULL UNIQUE CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 prepared_sha256 text NOT NULL CHECK(prepared_sha256 ~ '^[a-f0-9]{64}$'),
 imported_at timestamptz NOT NULL DEFAULT now(),
 data_mode text NOT NULL DEFAULT 'PUBLIC_DATASET' CHECK(data_mode='PUBLIC_DATASET'),
 metadata jsonb NOT NULL
);
CREATE TABLE research_daily_demand (
 dataset_id uuid NOT NULL REFERENCES research_datasets(id),
 outlet_id text NOT NULL,
 product_id uuid NOT NULL,
 date date NOT NULL,
 qty numeric(12,3) NOT NULL CHECK(qty>=0),
 quality text NOT NULL CHECK(quality IN ('observed','inferred_zero')),
 PRIMARY KEY(dataset_id,outlet_id,product_id,date)
);
CREATE TABLE research_replay_runs (
 id uuid PRIMARY KEY,
 dataset_id uuid NOT NULL REFERENCES research_datasets(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES users(id),
 cutoff date NOT NULL,
 horizon integer NOT NULL CHECK(horizon IN (1,7,30)),
 outlet_id text NOT NULL,
 product_id uuid,
 history_sha256 text NOT NULL CHECK(history_sha256 ~ '^[a-f0-9]{64}$'),
 input_history jsonb NOT NULL,
 metadata jsonb NOT NULL
);
CREATE INDEX research_replay_runs_time_idx ON research_replay_runs(created_at DESC,id);
CREATE TABLE research_replay_points (
 run_id uuid NOT NULL REFERENCES research_replay_runs(id),
 date date NOT NULL,
 product_id uuid NOT NULL,
 prediction jsonb NOT NULL,
 PRIMARY KEY(run_id,date,product_id)
);
CREATE TRIGGER research_datasets_immutable BEFORE UPDATE OR DELETE ON research_datasets FOR EACH ROW EXECUTE FUNCTION protect_forecast_archive();
CREATE TRIGGER research_demand_immutable BEFORE UPDATE OR DELETE ON research_daily_demand FOR EACH ROW EXECUTE FUNCTION protect_forecast_archive();
CREATE TRIGGER research_runs_immutable BEFORE UPDATE OR DELETE ON research_replay_runs FOR EACH ROW EXECUTE FUNCTION protect_forecast_archive();
CREATE TRIGGER research_points_immutable BEFORE UPDATE OR DELETE ON research_replay_points FOR EACH ROW EXECUTE FUNCTION protect_forecast_archive();
