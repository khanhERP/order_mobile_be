
-- Migration to handle email constraint for employees table
-- Drop the unique constraint on email since email is now optional
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_email_unique;

-- Add a new unique constraint that excludes empty strings and null values
-- This allows multiple employees with empty email but prevents duplicate actual emails
CREATE UNIQUE INDEX employees_email_unique_idx 
ON employees (email) 
WHERE email IS NOT NULL AND email != '';

-- Clean up any empty string emails to NULL for consistency
UPDATE employees SET email = NULL WHERE email = '';
