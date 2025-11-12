-- Add row_order column to purchase_receipt_items table
ALTER TABLE purchase_receipt_items 
ADD COLUMN IF NOT EXISTS row_order INTEGER DEFAULT 0;

-- Update existing rows with sequential order based on id
UPDATE purchase_receipt_items 
SET row_order = subquery.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY purchase_receipt_id ORDER BY id) as row_num
  FROM purchase_receipt_items
) AS subquery
WHERE purchase_receipt_items.id = subquery.id;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_row_order 
ON purchase_receipt_items(purchase_receipt_id, row_order);
