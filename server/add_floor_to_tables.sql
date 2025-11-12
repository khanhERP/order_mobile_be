
-- Migration to add floor column to tables
ALTER TABLE tables ADD COLUMN IF NOT EXISTS floor VARCHAR(50) DEFAULT '1층';

-- Update existing tables to have a default floor value
UPDATE tables SET floor = '1층' WHERE floor IS NULL;
