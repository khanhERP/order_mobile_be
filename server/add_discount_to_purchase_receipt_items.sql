
-- Add discount_percent and discount_amount columns to purchase_receipt_items table
ALTER TABLE purchase_receipt_items 
ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10, 2) DEFAULT 0.00;
