
-- Migration to add zone column to tables
ALTER TABLE tables ADD COLUMN IF NOT EXISTS zone VARCHAR(50) DEFAULT 'A구역';

-- Update existing tables to have a default zone value
UPDATE tables SET zone = 'A구역' WHERE zone IS NULL;
