
-- Migration to add before_tax_price column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS before_tax_price DECIMAL(18,2);

-- Add comment for the column
COMMENT ON COLUMN products.before_tax_price IS 'Price before tax when price_includes_tax is true';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_products_before_tax_price ON products(before_tax_price);
