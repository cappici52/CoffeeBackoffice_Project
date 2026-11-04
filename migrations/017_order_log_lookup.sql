-- Support parent-order FK checks and history lookup without scanning all logs.
CREATE INDEX order_status_logs_order_branch_idx ON order_status_logs(order_id,branch_id);
CREATE INDEX stock_movements_order_branch_idx ON stock_movements(ref_order_id,branch_id);
