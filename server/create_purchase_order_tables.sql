
-- Create purchase orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id) NOT NULL,
  employee_id INTEGER REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'pending',
  expected_delivery_date DATE,
  actual_delivery_date DATE,
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  tax DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create purchase order items table
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
  product_id INTEGER REFERENCES products(id) NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL,
  received_quantity INTEGER DEFAULT 0,
  unit_price DECIMAL(10, 2) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create purchase order documents table
CREATE TABLE IF NOT EXISTS purchase_order_documents (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
  document_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  uploaded_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_purchase_order_id ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_id ON purchase_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_documents_purchase_order_id ON purchase_order_documents(purchase_order_id);
