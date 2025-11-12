
-- Rename expected_delivery_date to purchase_date in purchase_orders table
DO $$ 
BEGIN
    -- Check if expected_delivery_date column exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'purchase_orders' 
        AND column_name = 'expected_delivery_date'
    ) THEN
        -- Rename the column
        ALTER TABLE purchase_orders 
        RENAME COLUMN expected_delivery_date TO purchase_date;
        
        RAISE NOTICE 'Successfully renamed expected_delivery_date to purchase_date in purchase_orders table';
    ELSE
        RAISE NOTICE 'Column expected_delivery_date does not exist in purchase_orders table';
    END IF;
END $$;
