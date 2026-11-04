-- Legacy balances retain unknown provenance/cost/expiry, not fabricated lots.
CREATE TABLE inventory_lots (
 id uuid PRIMARY KEY,branch_id uuid NOT NULL DEFAULT coffee_current_branch() REFERENCES branches(id),
 ingredient_id uuid NOT NULL REFERENCES ingredients(id),code text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),expires_on date,
 unit_cost_satang numeric(16,6) CHECK(unit_cost_satang>=0),
 remaining_qty numeric(16,3) NOT NULL DEFAULT 0 CHECK(remaining_qty>=0),
 legacy_unknown boolean NOT NULL DEFAULT false,
 UNIQUE(id,branch_id,ingredient_id),UNIQUE(id,branch_id)
);
CREATE INDEX inventory_lots_fefo_idx ON inventory_lots(branch_id,ingredient_id,expires_on,received_at,id) WHERE remaining_qty>0;
INSERT INTO inventory_lots(id,branch_id,ingredient_id,code,remaining_qty,legacy_unknown)
 SELECT gen_random_uuid(),branch_id,ingredient_id,'LEGACY-UNALLOCATED',current_stock,true FROM branch_stock WHERE current_stock>0;
ALTER TABLE stock_movements ADD COLUMN lot_id uuid;
ALTER TABLE stock_movements ADD FOREIGN KEY(lot_id,branch_id,ingredient_id) REFERENCES inventory_lots(id,branch_id,ingredient_id);
CREATE TABLE lot_allocations (
 movement_id uuid NOT NULL REFERENCES stock_movements(id),lot_id uuid NOT NULL,
 branch_id uuid NOT NULL DEFAULT coffee_current_branch(),ingredient_id uuid NOT NULL,
 qty numeric(16,3) NOT NULL CHECK(qty<>0),PRIMARY KEY(movement_id,lot_id),
 FOREIGN KEY(lot_id,branch_id,ingredient_id) REFERENCES inventory_lots(id,branch_id,ingredient_id)
);
CREATE FUNCTION allocate_stock_lots() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE remaining numeric:=abs(NEW.qty); lot inventory_lots%ROWTYPE; take numeric; target uuid; allocation record;
BEGIN
 IF NEW.qty>0 THEN
  IF NEW.type='return' AND NEW.lot_id IS NULL AND NEW.ref_order_id IS NOT NULL THEN
   FOR allocation IN SELECT a.lot_id,-a.qty AS qty FROM lot_allocations a JOIN stock_movements m ON m.id=a.movement_id
     WHERE m.ref_order_id=NEW.ref_order_id AND m.ingredient_id=NEW.ingredient_id AND m.branch_id=NEW.branch_id AND m.type='sale' ORDER BY a.lot_id LOOP
    take:=least(remaining,allocation.qty);
    UPDATE inventory_lots SET remaining_qty=remaining_qty+take WHERE id=allocation.lot_id;
    INSERT INTO lot_allocations VALUES(NEW.id,allocation.lot_id,NEW.branch_id,NEW.ingredient_id,take);
    remaining:=remaining-take;EXIT WHEN remaining=0;
   END LOOP;
   IF remaining=0 THEN RETURN NEW; END IF;
  END IF;
  target:=NEW.lot_id;
  IF target IS NULL THEN
   target:=NEW.id;
   INSERT INTO inventory_lots(id,branch_id,ingredient_id,code,legacy_unknown)
    VALUES(target,NEW.branch_id,NEW.ingredient_id,'UNALLOCATED-'||left(NEW.id::text,8),true);
  END IF;
  UPDATE inventory_lots SET remaining_qty=remaining_qty+remaining WHERE id=target AND branch_id=NEW.branch_id AND ingredient_id=NEW.ingredient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot does not belong to movement' USING ERRCODE='23514'; END IF;
  INSERT INTO lot_allocations VALUES(NEW.id,target,NEW.branch_id,NEW.ingredient_id,remaining);
 ELSE
  FOR lot IN SELECT * FROM inventory_lots WHERE branch_id=NEW.branch_id AND ingredient_id=NEW.ingredient_id AND remaining_qty>0
    AND (NEW.lot_id IS NULL OR id=NEW.lot_id)
    AND (NEW.type<>'sale' OR expires_on IS NULL OR expires_on>(now() AT TIME ZONE 'Asia/Bangkok')::date)
    ORDER BY expires_on NULLS LAST,received_at,id FOR UPDATE LOOP
   take:=least(remaining,lot.remaining_qty);
   UPDATE inventory_lots SET remaining_qty=remaining_qty-take WHERE id=lot.id;
   INSERT INTO lot_allocations VALUES(NEW.id,lot.id,NEW.branch_id,NEW.ingredient_id,-take);
   remaining:=remaining-take;EXIT WHEN remaining=0;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Insufficient usable lot stock' USING ERRCODE='P9001'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_lot_allocation AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION allocate_stock_lots();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['inventory_lots','lot_allocations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY branch_read ON %I FOR SELECT TO coffee_branch_runtime USING(branch_id=ANY(coffee_branch_ids()))',t);
  EXECUTE format('CREATE POLICY branch_insert ON %I FOR INSERT TO coffee_branch_runtime WITH CHECK(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'')',t);
  EXECUTE format('CREATE POLICY branch_update ON %I FOR UPDATE TO coffee_branch_runtime USING(branch_id=coffee_current_branch() AND current_setting(''coffee.branch_write'',true)=''on'') WITH CHECK(branch_id=coffee_current_branch())',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO coffee_branch_runtime',t);
 END LOOP;
END $$;
