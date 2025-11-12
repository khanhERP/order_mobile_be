-- Add customer phone and tax code columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_tax_code TEXT;

-- Create indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_customer_tax_code ON orders(customer_tax_code);
