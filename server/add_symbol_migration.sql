
-- Migration to add symbol column to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS symbol VARCHAR(20);
