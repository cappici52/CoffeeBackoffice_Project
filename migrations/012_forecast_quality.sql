CREATE TABLE forecast_day_quality (
 date date NOT NULL,
 product_id uuid NOT NULL REFERENCES products(id),
 kind text NOT NULL CHECK(kind IN ('normal','closed','stockout','incomplete')),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(date,product_id)
);
ALTER TABLE forecast_runs ADD COLUMN training_cohort text NOT NULL DEFAULT 'legacy'
 CHECK(training_cohort IN ('legacy','genuine','simulation','demo'));
ALTER TABLE forecast_runs ADD COLUMN input_quality jsonb NOT NULL DEFAULT '{}';
