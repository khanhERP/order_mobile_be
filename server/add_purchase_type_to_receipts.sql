
-- Add purchase_type column to purchase_receipts table
ALTER TABLE purchase_receipts 
ADD COLUMN IF NOT EXISTS purchase_type TEXT;

-- Add comment to describe the column
COMMENT ON COLUMN purchase_receipts.purchase_type IS 'Type of purchase: raw_materials, expenses, or others';

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_purchase_type 
ON purchase_receipts(purchase_type);

-- Log completion
DO $$ 
BEGIN
    RAISE NOTICE 'Successfully added purchase_type column to purchase_receipts table';
END $$;
