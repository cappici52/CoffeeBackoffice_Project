CREATE TABLE suppliers (
 id uuid PRIMARY KEY,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 phone text NOT NULL DEFAULT '',lead_time_days integer NOT NULL CHECK(lead_time_days BETWEEN 0 AND 365),
 is_active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1
);
CREATE TABLE purchase_orders (
 id uuid PRIMARY KEY,branch_id uuid NOT NULL DEFAULT coffee_current_branch() REFERENCES branches(id),
 supplier_id uuid NOT NULL REFERENCES suppliers(id),created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),expected_on date NOT NULL,
 lead_time_days integer NOT NULL CHECK(lead_time_days BETWEEN 0 AND 365),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','cancelled')),note text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1,UNIQUE(id,branch_id)
);
CREATE TABLE purchase_order_lines (
 id uuid PRIMARY KEY,order_id uuid NOT NULL,branch_id uuid NOT NULL DEFAULT coffee_current_branch(),
 ingredient_id uuid NOT NULL REFERENCES ingredients(id),qty numeric(16,3) NOT NULL CHECK(qty>0),
 received_qty numeric(16,3) NOT NULL DEFAULT 0 CHECK(received_qty>=0 AND received_qty<=qty),
 unit_cost_satang numeric(16,6) NOT NULL CHECK(unit_cost_satang>=0),
 UNIQUE(order_id,ingredient_id),FOREIGN KEY(order_id,branch_id) REFERENCES purchase_orders(id,branch_id),UNIQUE(id,branch_id)
);
CREATE TABLE purchase_receipts (
 id uuid PRIMARY KEY,order_id uuid NOT NULL,branch_id uuid NOT NULL DEFAULT coffee_current_branch(),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 request_key uuid NOT NULL,input_sha256 text NOT NULL,
 UNIQUE(branch_id,request_key),FOREIGN KEY(order_id,branch_id) REFERENCES purchase_orders(id,branch_id),UNIQUE(id,branch_id)
);
CREATE TABLE purchase_receipt_lines (
 receipt_id uuid NOT NULL,branch_id uuid NOT NULL DEFAULT coffee_current_branch(),line_id uuid NOT NULL,
 lot_id uuid NOT NULL,qty numeric(16,3) NOT NULL CHECK(qty>0),
 unit_cost_satang numeric(16,6) NOT NULL CHECK(unit_cost_satang>=0),
 PRIMARY KEY(receipt_id,line_id),FOREIGN KEY(receipt_id,branch_id) REFERENCES purchase_receipts(id,branch_id),
 FOREIGN KEY(line_id,branch_id) REFERENCES purchase_order_lines(id,branch_id),
 FOREIGN KEY(lot_id,branch_id) REFERENCES inventory_lots(id,branch_id)
);
CREATE TABLE operating_expenses (
 id uuid PRIMARY KEY,branch_id uuid NOT NULL DEFAULT coffee_current_branch() REFERENCES branches(id),
 date date NOT NULL,category text NOT NULL CHECK(length(category) BETWEEN 1 AND 120),
 amount_satang bigint NOT NULL CHECK(amount_satang>0),note text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz,void_reason text,request_key uuid NOT NULL,UNIQUE(branch_id,request_key)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','operating_expenses'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY branch_read ON %I FOR SELECT TO coffee_branch_runtime USING(branch_id=ANY(coffee_branch_ids()))',t);
  EXECUTE format('CREATE POLICY branch_insert ON %I FOR INSERT TO coffee_branch_runtime WITH CHECK(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'')',t);
  EXECUTE format('CREATE POLICY branch_update ON %I FOR UPDATE TO coffee_branch_runtime USING(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'') WITH CHECK(branch_id=coffee_current_branch())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO coffee_branch_runtime',t);
 END LOOP;
END $$;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_read ON suppliers FOR SELECT TO coffee_branch_runtime USING(true);
CREATE POLICY supplier_write ON suppliers TO coffee_branch_runtime USING(current_setting('coffee.master_write',true)='on') WITH CHECK(current_setting('coffee.master_write',true)='on');
GRANT SELECT,INSERT,UPDATE ON suppliers TO coffee_branch_runtime;
CREATE INDEX purchase_orders_branch_time_idx ON purchase_orders(branch_id,created_at DESC);
CREATE INDEX operating_expenses_branch_date_idx ON operating_expenses(branch_id,date);
