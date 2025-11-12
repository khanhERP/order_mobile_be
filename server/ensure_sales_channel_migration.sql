
-- Migration to ensure sales_channel column exists in orders table
DO $$ 
BEGIN
    -- Add sales_channel column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'orders' 
        AND column_name = 'sales_channel'
    ) THEN
        ALTER TABLE orders ADD COLUMN sales_channel TEXT NOT NULL DEFAULT 'table';
        RAISE NOTICE 'Added sales_channel column to orders table';
    ELSE
        RAISE NOTICE 'sales_channel column already exists in orders table';
    END IF;

    -- Add constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'orders_sales_channel_check'
        AND table_name = 'orders'
    ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_sales_channel_check 
        CHECK (sales_channel IN ('table', 'pos', 'online', 'delivery'));
        RAISE NOTICE 'Added sales_channel constraint to orders table';
    ELSE
        RAISE NOTICE 'sales_channel constraint already exists in orders table';
    END IF;

    -- Create indexes if they don't exist
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'orders'
        AND indexname = 'idx_orders_sales_channel'
    ) THEN
        CREATE INDEX idx_orders_sales_channel ON orders(sales_channel);
        RAISE NOTICE 'Created idx_orders_sales_channel index';
    ELSE
        RAISE NOTICE 'idx_orders_sales_channel index already exists';
    END IF;

    -- Update existing orders to set proper sales_channel
    UPDATE orders 
    SET sales_channel = CASE 
        WHEN table_id IS NOT NULL THEN 'table'  -- Orders with table_id are table orders
        WHEN table_id IS NULL THEN 'pos'        -- Orders without table_id are POS orders
        ELSE 'pos' -- Default to POS
    END 
    WHERE sales_channel IS NULL OR sales_channel = '' OR sales_channel = 'table' AND table_id IS NULL;

    RAISE NOTICE 'Updated existing orders with proper sales_channel values';
END $$;
