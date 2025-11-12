
-- Migration to add invoice_number column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50);

-- Add comment for the column
COMMENT ON COLUMN orders.invoice_number IS 'Invoice number from e-invoice system after successful publishing';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_orders_invoice_number ON orders(invoice_number);
