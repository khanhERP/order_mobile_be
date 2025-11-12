
-- Add payment information columns to purchase_receipts table
ALTER TABLE purchase_receipts 
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE purchase_receipts 
ADD COLUMN IF NOT EXISTS payment_method TEXT;

ALTER TABLE purchase_receipts 
ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(18,2);

-- Add comment to describe the columns
COMMENT ON COLUMN purchase_receipts.is_paid IS 'Payment status: true if paid, false if unpaid';
COMMENT ON COLUMN purchase_receipts.payment_method IS 'Payment method used (e.g., cash, bank_transfer, credit_card)';
COMMENT ON COLUMN purchase_receipts.payment_amount IS 'Amount paid for this receipt';

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_is_paid 
ON purchase_receipts(is_paid);

-- Log completion
DO $$ 
BEGIN
    RAISE NOTICE 'Successfully added payment information columns to purchase_receipts table';
END $$;
