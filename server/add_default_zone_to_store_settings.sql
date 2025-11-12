
-- Add default_zone column to store_settings table
ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS default_zone TEXT DEFAULT 'A';

-- Update existing records to have default zone value
UPDATE store_settings 
SET default_zone = COALESCE(default_zone, 'A')
WHERE default_zone IS NULL;

-- Add comment for the column
COMMENT ON COLUMN store_settings.default_zone IS 'Default zone for new tables';
