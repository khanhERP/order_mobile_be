
-- Add updated_at column to tables table
ALTER TABLE tables ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Update existing rows to have current timestamp
UPDATE tables SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;
