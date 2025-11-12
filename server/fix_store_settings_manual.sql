
-- Add missing timestamp columns to store_settings table
ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));

ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));

-- Update existing records with default timestamps
UPDATE store_settings 
SET 
  created_at = COALESCE(created_at, to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  updated_at = COALESCE(updated_at, to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE created_at IS NULL OR updated_at IS NULL;

-- Add other missing columns if needed
ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS pin_code TEXT,
ADD COLUMN IF NOT EXISTS tax_id TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS email TEXT;

-- Add zone_prefix column if missing
ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS zone_prefix TEXT DEFAULT '구역';

-- Update existing records
UPDATE store_settings 
SET zone_prefix = COALESCE(zone_prefix, '구역')
WHERE zone_prefix IS NULL;
