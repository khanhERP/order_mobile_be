
-- Add zone_prefix column to store_settings table and remove enable_multi_floor
ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS zone_prefix TEXT DEFAULT '구역';

-- Remove the enable_multi_floor column as it's no longer needed
ALTER TABLE store_settings 
DROP COLUMN IF EXISTS enable_multi_floor;

-- Update existing records to have default zone_prefix value
UPDATE store_settings 
SET zone_prefix = '구역'
WHERE zone_prefix IS NULL;
