
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
    console.log('📦 Connected to database for purchase receipt items migration');

    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrate_purchase_order_items_to_receipt_items.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📦 Running purchase receipt items migration...');
    await client.query(migrationSQL);
    console.log('✅ Purchase receipt items migration completed successfully!');

    // Verify migration
    const countOldTable = await client.query('SELECT COUNT(*) FROM purchase_order_items');
    const countNewTable = await client.query('SELECT COUNT(*) FROM purchase_receipt_items');
    
    console.log(`📊 Migration verification:`);
    console.log(`   - Old table (purchase_order_items): ${countOldTable.rows[0].count} records`);
    console.log(`   - New table (purchase_receipt_items): ${countNewTable.rows[0].count} records`);

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
