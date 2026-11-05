-- Keep old branch identities and ledgers for audit. The original workspace is
-- the only active shop, including for a fresh installation.
UPDATE branches
SET is_active = (id = '00000000-0000-4000-8000-000000000016'),
    version = version + 1,
    updated_at = now()
WHERE is_active IS DISTINCT FROM (id = '00000000-0000-4000-8000-000000000016');

ALTER TABLE branches ADD CONSTRAINT single_operating_shop
  CHECK (is_active = (id = '00000000-0000-4000-8000-000000000016'));

DROP TRIGGER new_branch_stock ON branches;
CREATE OR REPLACE FUNCTION initialize_branch_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO branch_stock(branch_id,ingredient_id,reorder_point,current_stock,version)
  SELECT id,NEW.id,NEW.reorder_point,NEW.current_stock,NEW.version FROM branches WHERE is_active;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_stocked_ingredient_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active AND EXISTS(
    SELECT 1 FROM branch_stock s JOIN branches b ON b.id=s.branch_id
    WHERE s.ingredient_id=NEW.id AND s.current_stock>0 AND b.is_active
  ) THEN
    RAISE EXCEPTION 'Ingredient still has shop stock' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION initialize_branch_stock() SET search_path=%I,pg_temp',current_schema());
  EXECUTE format('ALTER FUNCTION prevent_stocked_ingredient_archive() SET search_path=%I,pg_temp',current_schema());
END $$;

-- Carry forward the prices and availability customers already see. Retain the
-- override rows as history, and let the regular product editor own future edits.
UPDATE products p
SET price_satang = coalesce(s.price_satang, p.price_satang),
    is_available = coalesce(s.is_available, p.is_available),
    version = p.version + 1
FROM branch_products s
WHERE s.branch_id = '00000000-0000-4000-8000-000000000016'
  AND s.product_id = p.id
  AND (p.price_satang, p.is_available) IS DISTINCT FROM
      (coalesce(s.price_satang, p.price_satang), coalesce(s.is_available, p.is_available));

CREATE OR REPLACE VIEW branch_catalog WITH (security_invoker=true) AS
 SELECT p.id,p.category_id,p.name,p.description,p.price_satang,
 p.image_url,p.is_available,p.is_archived,p.station,p.target_prep_seconds,p.version,
 coalesce(s.forecast_since,p.forecast_since) AS forecast_since,b.id AS branch_id
 FROM products p CROSS JOIN branches b LEFT JOIN branch_products s ON s.product_id=p.id AND s.branch_id=b.id
 WHERE b.is_active AND b.id=ANY(coffee_branch_ids());
