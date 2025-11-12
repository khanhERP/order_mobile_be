-- Simple migration to fix payment_method column type
-- Check current column type
\d orders;

-- If payment_method is integer, we need to convert it
-- First backup any existing data
CREATE TABLE IF NOT EXISTS orders_payment_backup AS
SELECT id, payment_method FROM orders WHERE payment_method IS NOT NULL;

-- Drop the problematic column if it exists as integer
ALTER TABLE orders DROP COLUMN IF EXISTS payment_method;

-- Add it back as TEXT
ALTER TABLE orders ADD COLUMN payment_method TEXT;

-- Set default values for existing records
UPDATE orders SET payment_method = 'cash' WHERE payment_method IS NULL;

-- Verify the change
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'payment_method';