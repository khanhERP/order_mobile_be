
-- Add parent_order_id column to orders table to track split orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id INTEGER REFERENCES orders(id);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id ON orders(parent_order_id);
