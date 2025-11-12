
-- Migration to add price_includes_tax column to store_settings table
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS price_includes_tax BOOLEAN NOT NULL DEFAULT false;

-- Add comment for the column
COMMENT ON COLUMN store_settings.price_includes_tax IS 'Whether prices include tax by default in the store';

-- Update existing records to set default value to true
UPDATE store_settings SET price_includes_tax = true WHERE price_includes_tax IS NULL;
