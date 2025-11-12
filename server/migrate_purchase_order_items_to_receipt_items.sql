
-- Migration: Move data from purchase_order_items to purchase_receipt_items
-- Step 1: Create purchase_receipt_items table if not exists
CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id SERIAL PRIMARY KEY,
  purchase_receipt_id INTEGER NOT NULL,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL,
  received_quantity INTEGER NOT NULL DEFAULT 0,
  unit_price DECIMAL(10, 2) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 2: Copy all data from purchase_order_items to purchase_receipt_items
INSERT INTO purchase_receipt_items (
  purchase_receipt_id,
  product_id,
  product_name,
  sku,
  quantity,
  received_quantity,
  unit_price,
  total,
  created_at,
  updated_at
)
SELECT 
  purchase_order_id as purchase_receipt_id,
  product_id,
  product_name,
  sku,
  quantity,
  received_quantity,
  unit_price,
  total,
  created_at,
  updated_at
FROM purchase_order_items
WHERE NOT EXISTS (
  SELECT 1 FROM purchase_receipt_items pri 
  WHERE pri.purchase_receipt_id = purchase_order_items.purchase_order_id 
  AND pri.product_id = purchase_order_items.product_id
);

-- Step 3: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_purchase_receipt_id ON purchase_receipt_items(purchase_receipt_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_product_id ON purchase_receipt_items(product_id);

-- Step 4: Drop the old table (uncomment when ready)
-- DROP TABLE IF EXISTS purchase_order_items;

COMMIT;
