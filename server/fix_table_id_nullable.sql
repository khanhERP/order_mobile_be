-- Make table_id nullable in orders table
ALTER TABLE orders ALTER COLUMN table_id DROP NOT NULL;
