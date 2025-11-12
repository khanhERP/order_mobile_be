
-- Migration to add template_number and symbol columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS template_number VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS symbol VARCHAR(20);

-- Add comments for the columns
COMMENT ON COLUMN orders.template_number IS 'Template number from invoice template used for e-invoice issuance';
COMMENT ON COLUMN orders.symbol IS 'Symbol from invoice template used for e-invoice issuance';

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_orders_template_number ON orders(template_number);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
