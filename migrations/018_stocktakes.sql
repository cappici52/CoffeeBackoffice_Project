-- Counts are user-supplied physical observations, never generated demo balances.
CREATE TABLE stocktakes (
 id uuid PRIMARY KEY, branch_id uuid NOT NULL DEFAULT coffee_current_branch() REFERENCES branches(id),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 note text NOT NULL CHECK(length(note) BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','committed')),
 committed_at timestamptz, UNIQUE(id,branch_id),
 CHECK((status='committed')=(committed_at IS NOT NULL))
);
CREATE TABLE stocktake_lines (
 stocktake_id uuid NOT NULL, branch_id uuid NOT NULL DEFAULT coffee_current_branch(),
 ingredient_id uuid NOT NULL REFERENCES ingredients(id),
 counted_qty numeric(16,3) NOT NULL CHECK(counted_qty>=0),
 system_qty numeric(16,3) NOT NULL CHECK(system_qty>=0),
 stock_version integer NOT NULL CHECK(stock_version>0),
 PRIMARY KEY(stocktake_id,ingredient_id),
 FOREIGN KEY(stocktake_id,branch_id) REFERENCES stocktakes(id,branch_id)
);
ALTER TABLE branch_stock ADD COLUMN counted_at timestamptz;
ALTER TABLE branch_stock ADD COLUMN last_stocktake_id uuid;
ALTER TABLE branch_stock ADD FOREIGN KEY(last_stocktake_id,branch_id) REFERENCES stocktakes(id,branch_id);
ALTER TABLE stock_movements ADD COLUMN stocktake_id uuid;
ALTER TABLE stock_movements ADD FOREIGN KEY(stocktake_id,branch_id) REFERENCES stocktakes(id,branch_id);
CREATE UNIQUE INDEX stocktake_movement_once ON stock_movements(stocktake_id,ingredient_id) WHERE stocktake_id IS NOT NULL;
-- Preserve existing positive/negative movement constraints; adjustments use their
-- real signed delta and are identified separately from sales/receipts/waste.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_check;
ALTER TABLE stock_movements ADD CHECK(type IN ('receipt','waste','sale','return','adjustment'));
ALTER TABLE stock_movements ADD CHECK((type IN ('receipt','return') AND qty>0) OR (type IN ('waste','sale') AND qty<0) OR type='adjustment');
CREATE OR REPLACE VIEW stock_ingredients WITH(security_invoker=true) AS
 SELECT i.id,i.name,i.unit,s.current_stock,s.reorder_point,i.cost_satang,i.is_active,s.version,
 s.branch_id,s.counted_at,s.last_stocktake_id
 FROM ingredients i JOIN branch_stock s ON s.ingredient_id=i.id WHERE s.branch_id=ANY(coffee_branch_ids());
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['stocktakes','stocktake_lines'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY branch_read ON %I FOR SELECT TO coffee_branch_runtime USING(branch_id=ANY(coffee_branch_ids()))',t);
  EXECUTE format('CREATE POLICY branch_insert ON %I FOR INSERT TO coffee_branch_runtime WITH CHECK(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'')',t);
  EXECUTE format('CREATE POLICY branch_update ON %I FOR UPDATE TO coffee_branch_runtime USING(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'') WITH CHECK(branch_id=coffee_current_branch())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO coffee_branch_runtime',t);
 END LOOP;
END $$;
