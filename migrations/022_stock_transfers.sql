CREATE TABLE stock_transfers (
 id uuid PRIMARY KEY,source_branch_id uuid NOT NULL REFERENCES branches(id),target_branch_id uuid NOT NULL REFERENCES branches(id),
 ingredient_id uuid NOT NULL REFERENCES ingredients(id),qty numeric(16,3) NOT NULL CHECK(qty>0),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL,
 request_key uuid NOT NULL,input_sha256 text NOT NULL,UNIQUE(source_branch_id,request_key),
 CHECK(source_branch_id<>target_branch_id)
);
ALTER TABLE stock_movements ADD COLUMN transfer_id uuid REFERENCES stock_transfers(id);
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_check;
ALTER TABLE stock_movements ADD CHECK(type IN ('receipt','waste','sale','return','adjustment','transfer_out','transfer_in'));
ALTER TABLE stock_movements ADD CHECK((type IN ('receipt','return','transfer_in') AND qty>0) OR (type IN ('waste','sale','transfer_out') AND qty<0) OR type='adjustment');
CREATE INDEX stock_transfers_source_time_idx ON stock_transfers(source_branch_id,created_at DESC);
CREATE INDEX stock_transfers_target_time_idx ON stock_transfers(target_branch_id,created_at DESC);
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_read ON stock_transfers FOR SELECT TO coffee_branch_runtime USING(source_branch_id=ANY(coffee_branch_ids()) OR target_branch_id=ANY(coffee_branch_ids()));
CREATE POLICY transfer_create ON stock_transfers FOR INSERT TO coffee_branch_runtime WITH CHECK(source_branch_id=coffee_current_branch() AND current_setting('coffee.branch_write',true)='on');
GRANT SELECT,INSERT ON stock_transfers TO coffee_branch_runtime;
