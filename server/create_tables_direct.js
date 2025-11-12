
import { Client } from 'pg';
import fs from 'fs';

async function createTables() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('📦 Connected to database');

    // Create purchase_orders table
    await client.query(`
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
    `);
    console.log('✅ Created purchase_orders table');

    // Create purchase_order_items table
    await client.query(`
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
    `);
    console.log('✅ Created purchase_order_items table');

    // Create purchase_order_documents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_documents (
        id SERIAL PRIMARY KEY,
        purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
        document_name TEXT NOT NULL,
        document_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        uploaded_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    console.log('✅ Created purchase_order_documents table');

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders(created_at);
      CREATE INDEX IF NOT EXISTS idx_purchase_order_items_purchase_order_id ON purchase_order_items(purchase_order_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_id ON purchase_order_items(product_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_order_documents_purchase_order_id ON purchase_order_documents(purchase_order_id);
    `);
    console.log('✅ Created indexes');

    console.log('🎉 All purchase order tables created successfully!');

  } catch (error) {
    console.error('❌ Error creating tables:', error);
  } finally {
    await client.end();
    console.log('📦 Database connection closed');
  }
}

createTables();
