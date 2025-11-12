
-- Migration: Remove status column from purchase_receipts table
-- Purchase receipts don't need status tracking

-- Remove the status column from purchase_receipts table
ALTER TABLE purchase_receipts DROP COLUMN IF EXISTS status;

-- Log the change
DO $$ 
BEGIN
    RAISE NOTICE 'Successfully removed status column from purchase_receipts table';
END $$;

COMMIT;
