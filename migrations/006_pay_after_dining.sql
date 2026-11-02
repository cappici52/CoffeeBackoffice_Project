ALTER TABLE orders ADD COLUMN confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN confirmed_by uuid REFERENCES users(id);

-- Existing paid orders already consumed stock; do not consume it again.
UPDATE orders o SET confirmed_at=p.paid_at, confirmed_by=p.confirmed_by
FROM payments p WHERE p.order_id=o.id;

ALTER TABLE orders ADD CONSTRAINT orders_confirmation_actor
CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL));
