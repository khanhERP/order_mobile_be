
-- Migration to add price_include_tax column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_include_tax BOOLEAN NOT NULL DEFAULT false;

-- Add comment for the column
COMMENT ON COLUMN orders.price_include_tax IS 'Whether prices include tax for this specific order';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_orders_price_include_tax ON orders(price_include_tax);

-- Update existing records based on store_settings
UPDATE orders 
SET price_include_tax = (
    SELECT COALESCE(price_includes_tax, false) 
    FROM store_settings 
    LIMIT 1
) 
WHERE price_include_tax IS NULL;
