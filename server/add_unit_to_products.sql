
-- Add unit column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'Cái';
