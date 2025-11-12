
-- Migration to add templateCode column to invoice_templates table
ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS template_code VARCHAR(50);
