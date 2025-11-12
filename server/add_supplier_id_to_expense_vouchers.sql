
-- Add supplier_id column to expense_vouchers table
ALTER TABLE expense_vouchers 
ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_expense_vouchers_supplier_id 
ON expense_vouchers(supplier_id);
