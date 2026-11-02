CREATE TABLE dining_tables (
 id uuid PRIMARY KEY,
 name text NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 30),
 qr_token text NOT NULL UNIQUE CHECK(qr_token ~ '^[a-f0-9]{64}$'),
 is_active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE orders ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE order_status_logs ALTER COLUMN changed_by DROP NOT NULL;
ALTER TABLE orders ADD COLUMN source text NOT NULL DEFAULT 'pos' CHECK(source IN ('pos','qr'));
ALTER TABLE orders ADD COLUMN dining_table_id uuid REFERENCES dining_tables(id);
ALTER TABLE orders ADD COLUMN guest_tracking_hash text UNIQUE CHECK(guest_tracking_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE orders ADD CONSTRAINT orders_source_actor CHECK(
 (source='pos' AND created_by IS NOT NULL AND dining_table_id IS NULL AND guest_tracking_hash IS NULL)
 OR (source='qr' AND created_by IS NULL AND dining_table_id IS NOT NULL AND guest_tracking_hash IS NOT NULL AND type='dine-in')
);
CREATE INDEX orders_dining_table_idx ON orders(dining_table_id,status);
