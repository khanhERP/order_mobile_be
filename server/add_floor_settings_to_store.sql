
-- Add floor/zone management fields to store_settings table
ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS default_floor TEXT DEFAULT '1',
ADD COLUMN IF NOT EXISTS enable_multi_floor BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS floor_prefix TEXT DEFAULT '층';

-- Update existing records to have default values
UPDATE store_settings 
SET 
  default_floor = '1',
  enable_multi_floor = false,
  floor_prefix = '층'
WHERE 
  default_floor IS NULL 
  OR enable_multi_floor IS NULL 
  OR floor_prefix IS NULL;
