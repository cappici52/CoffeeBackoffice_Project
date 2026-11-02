CREATE TABLE forecast_jobs (
 run_date date PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now(), model_version text NOT NULL
);
