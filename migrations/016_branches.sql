-- Preserve the formerly single workspace explicitly; never guess physical branches.
CREATE TABLE branches (
 id uuid PRIMARY KEY, code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9_-]{1,30}$'),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), address text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 is_active boolean NOT NULL DEFAULT true, is_legacy boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO branches(id,code,name,is_legacy) VALUES
 ('00000000-0000-4000-8000-000000000016','LEGACY','สาขาเดิม',true),
 ('00000000-0000-4000-8000-000000000017','BR02','สาขา 2',false),
 ('00000000-0000-4000-8000-000000000018','BR03','สาขา 3',false);
CREATE TABLE user_branches (
 user_id uuid NOT NULL REFERENCES users(id), branch_id uuid NOT NULL REFERENCES branches(id),
 PRIMARY KEY(user_id,branch_id)
);
INSERT INTO user_branches SELECT id,'00000000-0000-4000-8000-000000000016' FROM users WHERE role<>'owner';

CREATE FUNCTION coffee_branch_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
 SELECT string_to_array(coalesce(nullif(current_setting('coffee.branch_ids',true),''),'00000000-0000-4000-8000-000000000016'),',')::uuid[]
$$;
CREATE FUNCTION coffee_current_branch() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE ids uuid[]:=coffee_branch_ids();
BEGIN
 IF cardinality(ids)<>1 THEN RAISE EXCEPTION 'Single branch required' USING ERRCODE='42501'; END IF;
 RETURN ids[1];
END $$;

-- The runtime explicitly SET LOCAL ROLE: RLS must not run as the migration owner/superuser.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='coffee_branch_runtime') THEN
  CREATE ROLE coffee_branch_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='coffee_branch_runtime' AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Unsafe coffee_branch_runtime role';
 END IF;
 EXECUTE format('GRANT coffee_branch_runtime TO %I',current_user);
END $$;

-- Metadata defaults backfill without UPDATE triggers, including append-only archives.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','order_items','payments','order_status_logs','stock_movements','day_closings','sales_daily','forecasts','forecast_runs','forecast_run_points','forecast_day_quality','forecast_jobs','dining_tables','payment_qr','audit_logs','shop_simulation_runs','shop_simulation_products'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN branch_id uuid NOT NULL DEFAULT ''00000000-0000-4000-8000-000000000016'' REFERENCES branches(id)',t);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN branch_id SET DEFAULT coffee_current_branch()',t);
  EXECUTE format('CREATE INDEX %I ON %I(branch_id)',t||'_branch_idx',t);
 END LOOP;
END $$;
ALTER TABLE orders ADD UNIQUE(id,branch_id);
ALTER TABLE order_items ADD FOREIGN KEY(order_id,branch_id) REFERENCES orders(id,branch_id);
ALTER TABLE payments ADD FOREIGN KEY(order_id,branch_id) REFERENCES orders(id,branch_id);
ALTER TABLE order_status_logs ADD FOREIGN KEY(order_id,branch_id) REFERENCES orders(id,branch_id);
ALTER TABLE stock_movements ADD FOREIGN KEY(ref_order_id,branch_id) REFERENCES orders(id,branch_id);
ALTER TABLE dining_tables ADD UNIQUE(id,branch_id);
ALTER TABLE orders ADD FOREIGN KEY(dining_table_id,branch_id) REFERENCES dining_tables(id,branch_id);
ALTER TABLE forecast_runs ADD UNIQUE(id,branch_id);
ALTER TABLE forecast_run_points ADD FOREIGN KEY(run_id,branch_id) REFERENCES forecast_runs(id,branch_id);
ALTER TABLE forecast_jobs ADD FOREIGN KEY(run_id,branch_id) REFERENCES forecast_runs(id,branch_id);
ALTER TABLE shop_simulation_runs ADD UNIQUE(id,branch_id);
ALTER TABLE shop_simulation_products ADD FOREIGN KEY(run_id,branch_id) REFERENCES shop_simulation_runs(id,branch_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','payments','stock_movements','day_closings','forecast_runs'] LOOP
  EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY(simulation_run_id,branch_id) REFERENCES shop_simulation_runs(id,branch_id)',t);
 END LOOP;
END $$;
CREATE INDEX orders_branch_created_idx ON orders(branch_id,created_at DESC,id);
CREATE INDEX orders_branch_status_idx ON orders(branch_id,status,created_at);
CREATE INDEX payments_branch_paid_idx ON payments(branch_id,paid_at);
CREATE INDEX movements_branch_created_idx ON stock_movements(branch_id,created_at DESC,id);
CREATE INDEX forecast_runs_branch_time_idx ON forecast_runs(branch_id,generated_at DESC,id);
CREATE INDEX forecast_points_branch_date_idx ON forecast_run_points(branch_id,forecast_date,product_id);
ALTER TABLE day_closings DROP CONSTRAINT day_closings_pkey;
ALTER TABLE day_closings ADD PRIMARY KEY(branch_id,date);
ALTER TABLE sales_daily DROP CONSTRAINT sales_daily_pkey;
ALTER TABLE sales_daily ADD PRIMARY KEY(branch_id,date,product_id,source);
ALTER TABLE forecasts DROP CONSTRAINT forecasts_forecast_date_product_id_key;
ALTER TABLE forecasts ADD UNIQUE(branch_id,forecast_date,product_id);
ALTER TABLE forecast_day_quality DROP CONSTRAINT forecast_day_quality_pkey;
ALTER TABLE forecast_day_quality ADD PRIMARY KEY(branch_id,date,product_id);
ALTER TABLE forecast_jobs DROP CONSTRAINT forecast_jobs_pkey;
ALTER TABLE forecast_jobs ADD PRIMARY KEY(branch_id,run_date,horizon);
ALTER TABLE dining_tables DROP CONSTRAINT dining_tables_name_key;
ALTER TABLE dining_tables ADD UNIQUE(branch_id,name);
ALTER TABLE payment_qr DROP CONSTRAINT payment_qr_pkey;
ALTER TABLE payment_qr ADD PRIMARY KEY(branch_id,id);

CREATE TABLE branch_stock (
 branch_id uuid NOT NULL DEFAULT coffee_current_branch() REFERENCES branches(id),
 ingredient_id uuid NOT NULL REFERENCES ingredients(id),
 current_stock numeric(16,3) NOT NULL DEFAULT 0 CHECK(current_stock>=0),
 reorder_point numeric(16,3) NOT NULL DEFAULT 0 CHECK(reorder_point>=0), version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(branch_id,ingredient_id)
);
INSERT INTO branch_stock(branch_id,ingredient_id,current_stock,reorder_point,version)
 SELECT b.id,i.id,CASE WHEN b.is_legacy THEN i.current_stock ELSE 0 END,i.reorder_point,
 CASE WHEN b.is_legacy THEN i.version ELSE 1 END FROM branches b CROSS JOIN ingredients i;
CREATE TABLE branch_products (
 branch_id uuid NOT NULL DEFAULT coffee_current_branch() REFERENCES branches(id),product_id uuid NOT NULL REFERENCES products(id),
 price_satang integer CHECK(price_satang>=0), is_available boolean,
 forecast_since date, version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(branch_id,product_id)
);
CREATE FUNCTION initialize_branch_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF TG_TABLE_NAME='branches' THEN
  INSERT INTO branch_stock(branch_id,ingredient_id,reorder_point) SELECT NEW.id,id,reorder_point FROM ingredients;
 ELSE
  INSERT INTO branch_stock(branch_id,ingredient_id,reorder_point,current_stock,version)
   SELECT id,NEW.id,NEW.reorder_point,CASE WHEN is_legacy THEN NEW.current_stock ELSE 0 END,CASE WHEN is_legacy THEN NEW.version ELSE 1 END FROM branches;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER new_branch_stock AFTER INSERT ON branches FOR EACH ROW EXECUTE FUNCTION initialize_branch_stock();
CREATE TRIGGER new_ingredient_stock AFTER INSERT ON ingredients FOR EACH ROW EXECUTE FUNCTION initialize_branch_stock();
-- Legacy column is retained only for compatibility with old diagnostics; live balances use branch_stock.
CREATE FUNCTION mirror_legacy_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.branch_id='00000000-0000-4000-8000-000000000016' THEN
  UPDATE ingredients SET current_stock=NEW.current_stock,version=NEW.version WHERE id=NEW.ingredient_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_stock_mirror AFTER UPDATE ON branch_stock FOR EACH ROW EXECUTE FUNCTION mirror_legacy_stock();
CREATE FUNCTION prevent_stocked_ingredient_archive() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF OLD.is_active AND NOT NEW.is_active AND EXISTS(SELECT 1 FROM branch_stock WHERE ingredient_id=NEW.id AND current_stock>0) THEN
  RAISE EXCEPTION 'Ingredient still has branch stock' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stocked_ingredient_archive BEFORE UPDATE OF is_active ON ingredients FOR EACH ROW EXECUTE FUNCTION prevent_stocked_ingredient_archive();

CREATE VIEW stock_ingredients WITH(security_invoker=true) AS
 SELECT i.id,i.name,i.unit,s.current_stock,s.reorder_point,i.cost_satang,i.is_active,s.version,s.branch_id
 FROM ingredients i JOIN branch_stock s ON s.ingredient_id=i.id WHERE s.branch_id=ANY(coffee_branch_ids());
CREATE VIEW branch_catalog WITH(security_invoker=true) AS
 SELECT p.id,p.category_id,p.name,p.description,coalesce(s.price_satang,p.price_satang) AS price_satang,
 p.image_url,coalesce(s.is_available,p.is_available) AS is_available,p.is_archived,p.station,p.target_prep_seconds,p.version,
 coalesce(s.forecast_since,CASE WHEN b.is_legacy THEN p.forecast_since ELSE greatest(p.forecast_since,(b.created_at AT TIME ZONE 'Asia/Bangkok')::date) END) AS forecast_since,b.id AS branch_id
 FROM products p CROSS JOIN branches b LEFT JOIN branch_products s ON s.product_id=p.id AND s.branch_id=b.id
 WHERE b.id=ANY(coffee_branch_ids());

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','order_items','payments','order_status_logs','stock_movements','day_closings','sales_daily','forecasts','forecast_runs','forecast_run_points','forecast_day_quality','forecast_jobs','dining_tables','payment_qr','audit_logs','shop_simulation_runs','shop_simulation_products','branch_stock','branch_products'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY branch_read ON %I FOR SELECT TO coffee_branch_runtime USING(branch_id=ANY(coffee_branch_ids()))',t);
  EXECUTE format('CREATE POLICY branch_insert ON %I FOR INSERT TO coffee_branch_runtime WITH CHECK(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'')',t);
  EXECUTE format('CREATE POLICY branch_update ON %I FOR UPDATE TO coffee_branch_runtime USING(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'') WITH CHECK(branch_id=coffee_current_branch())',t);
  EXECUTE format('CREATE POLICY branch_delete ON %I FOR DELETE TO coffee_branch_runtime USING(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'')',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['products','categories','ingredients','recipes','recipe_ingredients','recipe_steps','product_option_groups','product_options','menu_images'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY master_read ON %I FOR SELECT TO coffee_branch_runtime USING(true)',t);
  EXECUTE format('CREATE POLICY master_write ON %I TO coffee_branch_runtime USING(current_setting(''coffee.master_write'',true)=''on'') WITH CHECK(current_setting(''coffee.master_write'',true)=''on'')',t);
 END LOOP;
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO coffee_branch_runtime',current_schema());
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA %I TO coffee_branch_runtime',current_schema());
 EXECUTE format('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA %I TO coffee_branch_runtime',current_schema());
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION initialize_branch_stock() SET search_path=%I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION mirror_legacy_stock() SET search_path=%I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION prevent_stocked_ingredient_archive() SET search_path=%I,pg_temp',current_schema());
END $$;
