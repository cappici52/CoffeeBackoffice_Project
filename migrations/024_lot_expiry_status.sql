-- Do not force non-perishable items to have invented expiry dates.
ALTER TABLE inventory_lots ADD COLUMN expiry_kind text NOT NULL DEFAULT 'unknown' CHECK(expiry_kind IN ('unknown','dated','none'));
UPDATE inventory_lots SET expiry_kind='dated' WHERE expires_on IS NOT NULL;
CREATE FUNCTION normalize_lot_expiry_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.expires_on IS NOT NULL THEN
  IF NEW.expiry_kind='none' THEN RAISE EXCEPTION 'No-expiry lot cannot have an expiry date' USING ERRCODE='23514'; END IF;
  NEW.expiry_kind:='dated';
 ELSIF NEW.expiry_kind='dated' THEN RAISE EXCEPTION 'Dated lot requires an expiry date' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lot_expiry_status BEFORE INSERT OR UPDATE OF expires_on,expiry_kind ON inventory_lots FOR EACH ROW EXECUTE FUNCTION normalize_lot_expiry_status();
ALTER TABLE inventory_lots ADD CHECK((expiry_kind='dated' AND expires_on IS NOT NULL) OR (expiry_kind IN ('unknown','none') AND expires_on IS NULL));
