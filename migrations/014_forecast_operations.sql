ALTER TABLE forecast_day_quality DROP CONSTRAINT forecast_day_quality_kind_check;
ALTER TABLE forecast_day_quality ADD CONSTRAINT forecast_day_quality_kind_check CHECK(kind IN ('normal','incomplete','stockout','closed','outlier','unknown'));
ALTER TABLE forecast_runs ADD COLUMN planning_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE forecast_jobs ADD COLUMN horizon integer NOT NULL DEFAULT 7 CHECK(horizon IN (1,7,30));
ALTER TABLE forecast_jobs ADD COLUMN run_id uuid REFERENCES forecast_runs(id);
ALTER TABLE forecast_jobs DROP CONSTRAINT forecast_jobs_pkey;
ALTER TABLE forecast_jobs ADD PRIMARY KEY(run_date,horizon);
