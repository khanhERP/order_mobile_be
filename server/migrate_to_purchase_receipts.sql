
-- Migration script to rename purchase order tables to purchase receipt tables
-- This script maintains data integrity while changing table names

-- Step 1: Rename main table
ALTER TABLE IF EXISTS purchase_orders RENAME TO purchase_receipts;

-- Step 2: Rename items table  
ALTER TABLE IF EXISTS purchase_order_items RENAME TO purchase_receipt_items;

-- Step 3: Rename documents table
ALTER TABLE IF EXISTS purchase_order_documents RENAME TO purchase_receipt_documents;

-- Step 4: Update foreign key column names
-- Rename purchase_order_id to purchase_receipt_id in items table
ALTER TABLE IF EXISTS purchase_receipt_items 
RENAME COLUMN purchase_order_id TO purchase_receipt_id;

-- Rename purchase_order_id to purchase_receipt_id in documents table  
ALTER TABLE IF EXISTS purchase_receipt_documents
RENAME COLUMN purchase_order_id TO purchase_receipt_id;

-- Step 5: Update indexes to reflect new table names
DROP INDEX IF EXISTS idx_purchase_orders_po_number;
DROP INDEX IF EXISTS idx_purchase_orders_supplier_id; 
DROP INDEX IF EXISTS idx_purchase_orders_status;
DROP INDEX IF EXISTS idx_purchase_order_items_po_id;
DROP INDEX IF EXISTS idx_purchase_order_items_product_id;
DROP INDEX IF EXISTS idx_purchase_order_documents_po_id;

-- Recreate indexes with new names
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_po_number ON purchase_receipts(po_number);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_supplier_id ON purchase_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_receipt_id ON purchase_receipt_items(purchase_receipt_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_product_id ON purchase_receipt_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_documents_receipt_id ON purchase_receipt_documents(purchase_receipt_id);

-- Step 6: Update any stored procedures or views that reference the old table names
-- (Add specific updates if any exist in your database)

COMMIT;
