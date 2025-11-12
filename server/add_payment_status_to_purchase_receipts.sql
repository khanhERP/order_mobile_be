
-- Add payment_status column to purchase_receipts table
ALTER TABLE purchase_receipts 
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';

-- Add comment to describe the column
COMMENT ON COLUMN purchase_receipts.payment_status IS 'Payment status: paid, unpaid, partial';

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_payment_status 
ON purchase_receipts(payment_status);

-- Log completion
DO $$ 
BEGIN
    RAISE NOTICE 'Successfully added payment_status column to purchase_receipts table';
END $$;
