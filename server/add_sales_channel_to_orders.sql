
-- Migration to add sales_channel column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_channel TEXT NOT NULL DEFAULT 'table';

-- Add constraint to ensure valid sales channel values
ALTER TABLE orders ADD CONSTRAINT IF NOT EXISTS orders_sales_channel_check 
  CHECK (sales_channel IN ('table', 'pos', 'online', 'delivery'));

-- Update existing orders to set appropriate sales channel
UPDATE orders SET sales_channel = 'table' WHERE table_id IS NOT NULL;
UPDATE orders SET sales_channel = 'pos' WHERE table_id IS NULL;

-- Add index for better performance when filtering by sales channel
CREATE INDEX IF NOT EXISTS idx_orders_sales_channel ON orders(sales_channel);

-- Add comments for the column
COMMENT ON COLUMN orders.sales_channel IS 'Source of the order: table (restaurant), pos (direct sales), online, delivery';
