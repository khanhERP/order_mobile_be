
-- Migration to fix salesChannel for all orders
-- Update orders without salesChannel or with incorrect salesChannel

-- First, add the column if it doesn't exist (should already exist)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_channel TEXT NOT NULL DEFAULT 'table';

-- Update existing orders to set proper salesChannel
UPDATE orders 
SET sales_channel = CASE 
    WHEN table_id IS NOT NULL THEN 'table'  -- Orders with table_id are table orders
    WHEN table_id IS NULL THEN 'pos'        -- Orders without table_id are POS orders
    ELSE 'pos' -- Default to POS
END 
WHERE sales_channel IS NULL OR sales_channel = '';

-- Ensure constraint exists
ALTER TABLE orders ADD CONSTRAINT IF NOT EXISTS orders_sales_channel_check 
  CHECK (sales_channel IN ('table', 'pos', 'online', 'delivery'));

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_orders_sales_channel ON orders(sales_channel);

-- Add index for common queries
CREATE INDEX IF NOT EXISTS idx_orders_status_channel ON orders(status, sales_channel);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status_channel ON orders(payment_status, sales_channel);

-- Update any NULL payment_status to 'paid' for completed orders
UPDATE orders 
SET payment_status = 'paid' 
WHERE status = 'paid' AND payment_status IS NULL;

-- Update any NULL payment_method for paid orders
UPDATE orders 
SET payment_method = 'cash' 
WHERE status = 'paid' AND payment_method IS NULL;
