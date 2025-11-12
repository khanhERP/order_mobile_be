-- Add productType column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type INTEGER DEFAULT 1;

-- Update existing products to have default product type (1 = Hàng hóa)
UPDATE products SET product_type = 1 WHERE product_type IS NULL;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);