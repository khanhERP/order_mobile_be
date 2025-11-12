
-- Migration to add discount column to order_items table
psql "postgresql://postgres:Info%402024@1.55.212.135:5432/edpod" -c "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0.00;"

-- Add comment for the column
psql "postgresql://postgres:Info%402024@1.55.212.135:5432/edpod" -c "COMMENT ON COLUMN order_items.discount IS 'Discount amount allocated to this order item';"

-- Create index for better performance when filtering by discount
psql "postgresql://postgres:Info%402024@1.55.212.135:5432/edpod" -c "CREATE INDEX IF NOT EXISTS idx_order_items_discount ON order_items(discount);"

-- Update existing order items to set discount to 0 if null
psql "postgresql://postgres:Info%402024@1.55.212.135:5432/edpod" -c "UPDATE order_items SET discount = 0.00 WHERE discount IS NULL;"
