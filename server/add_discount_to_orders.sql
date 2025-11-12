
-- Migration to add discount column to orders table using direct connection string
psql "postgresql://postgres:Info%402024@1.55.212.135:5432/edpod" -c "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0.00;"

-- Add comment for the column
psql "postgresql://postgres:Info%402024@1.55.212.135:5432/edpod" -c "COMMENT ON COLUMN orders.discount IS 'Discount amount applied to the order';"

-- Create index for better performance when filtering by discount
psql "postgresql://postgres:Info%402024@1.55.212.135:5432/edpod" -c "CREATE INDEX IF NOT EXISTS idx_orders_discount ON orders(discount);"

-- Update existing orders to set discount to 0 if null
psql "postgresql://postgres:Info%402024@1.55.212.135:5432/edpod" -c "UPDATE orders SET discount = 0.00 WHERE discount IS NULL;"
