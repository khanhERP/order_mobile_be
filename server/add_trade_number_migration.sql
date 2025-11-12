-- Migration to add trade_number column and move data from invoice_number
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trade_number VARCHAR(50);

-- Copy data from invoice_number to trade_number
UPDATE invoices SET trade_number = invoice_number WHERE trade_number IS NULL;

-- Clear invoice_number column
UPDATE invoices SET invoice_number = NULL;

-- Create index for trade_number
CREATE INDEX IF NOT EXISTS idx_invoices_trade_number ON invoices(trade_number);
