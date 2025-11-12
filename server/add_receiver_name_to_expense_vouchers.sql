
-- Add receiver_name column to expense_vouchers table
ALTER TABLE expense_vouchers 
ADD COLUMN IF NOT EXISTS receiver_name VARCHAR(255);
