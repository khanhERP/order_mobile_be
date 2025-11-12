
-- Increase precision for purchase_receipts table to handle larger Vietnamese currency amounts
ALTER TABLE purchase_receipts 
  ALTER COLUMN subtotal TYPE DECIMAL(18, 2),
  ALTER COLUMN tax TYPE DECIMAL(18, 2),
  ALTER COLUMN total TYPE DECIMAL(18, 2);

-- Increase precision for purchase_receipt_items table
ALTER TABLE purchase_receipt_items 
  ALTER COLUMN unit_price TYPE DECIMAL(18, 2),
  ALTER COLUMN total TYPE DECIMAL(18, 2),
  ALTER COLUMN discount_amount TYPE DECIMAL(18, 2);

-- Also update purchase_orders table if it exists (legacy)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'purchase_orders') THEN
        ALTER TABLE purchase_orders 
          ALTER COLUMN subtotal TYPE DECIMAL(18, 2),
          ALTER COLUMN tax TYPE DECIMAL(18, 2),
          ALTER COLUMN total TYPE DECIMAL(18, 2);
    END IF;
END $$;

-- Log completion
DO $$ 
BEGIN
    RAISE NOTICE 'Successfully increased precision for purchase receipt financial columns to DECIMAL(18,2)';
END $$;
