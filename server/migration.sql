-- Migration script to add membership threshold columns
-- Add missing columns for membership thresholds
ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS gold_threshold TEXT DEFAULT '300000';

ALTER TABLE store_settings 
ADD COLUMN IF NOT EXISTS vip_threshold TEXT DEFAULT '1000000';

-- Update existing records if they don't have these values
UPDATE store_settings 
SET gold_threshold = '300000', vip_threshold = '1000000' 
WHERE gold_threshold IS NULL OR vip_threshold IS NULL;

-- Add businessType column to store_settings table
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'restaurant';