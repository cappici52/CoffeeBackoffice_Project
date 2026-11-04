CREATE FUNCTION protect_stocktake_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='committed' THEN RAISE EXCEPTION 'Committed stocktake is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stocktake_history BEFORE UPDATE OR DELETE ON stocktakes FOR EACH ROW EXECUTE FUNCTION protect_stocktake_record();
CREATE FUNCTION protect_stocktake_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent uuid; state text;
BEGIN
 IF TG_OP='DELETE' THEN parent:=OLD.stocktake_id; ELSE parent:=NEW.stocktake_id; END IF;
 SELECT status INTO state FROM stocktakes WHERE id=parent FOR SHARE;
 IF state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Only draft stocktake lines may change'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stocktake_line_history BEFORE INSERT OR UPDATE OR DELETE ON stocktake_lines FOR EACH ROW EXECUTE FUNCTION protect_stocktake_line();
