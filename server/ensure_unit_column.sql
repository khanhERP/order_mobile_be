
-- Ensure unit column exists in products table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'products' 
        AND column_name = 'unit'
    ) THEN
        ALTER TABLE products ADD COLUMN unit TEXT DEFAULT 'Cái';
        RAISE NOTICE 'Added unit column to products table';
    ELSE
        RAISE NOTICE 'Unit column already exists in products table';
    END IF;
END $$;

-- Update existing products to have default unit if NULL
UPDATE products SET unit = 'Cái' WHERE unit IS NULL;
