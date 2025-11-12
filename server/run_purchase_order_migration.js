
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('📦 Connected to database for purchase order migration');

    // Read the migration file
    const migrationPath = path.join(__dirname, 'create_purchase_order_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📦 Running purchase order tables migration...');
    await client.query(migrationSQL);
    console.log('✅ Purchase order tables migration completed successfully!');

    // Verify tables were created
    const checkTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('purchase_orders', 'purchase_order_items', 'purchase_order_documents')
      ORDER BY table_name;
    `);

    console.log('📋 Created tables:', checkTables.rows.map(row => row.table_name));

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('📦 Database connection closed');
  }
}

// Run the migration
runMigration();
