CREATE FUNCTION protect_posted_inventory_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Posted inventory record is immutable' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['purchase_receipts','purchase_receipt_lines','stock_transfers','lot_allocations'] LOOP
  EXECUTE format('CREATE TRIGGER posted_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_posted_inventory_history()',t);
 END LOOP;
END $$;
ALTER TABLE operating_expenses ADD CHECK((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND length(trim(void_reason))>0));
CREATE FUNCTION protect_expense_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Expense history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR
   (to_jsonb(NEW)-'voided_at'-'void_reason') IS DISTINCT FROM (to_jsonb(OLD)-'voided_at'-'void_reason') THEN
  RAISE EXCEPTION 'Expense can only be voided once without changing its original data' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_history BEFORE UPDATE OR DELETE ON operating_expenses FOR EACH ROW EXECUTE FUNCTION protect_expense_history();
