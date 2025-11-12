
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
    console.log('📦 Connected to database for purchase receipts status removal');

    // Read the migration file
    const migrationPath = path.join(__dirname, 'remove_status_from_purchase_receipts.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📦 Running migration to remove status column from purchase_receipts...');
    await client.query(migrationSQL);
    console.log('✅ Status column removal migration completed successfully!');

    // Verify the column has been removed
    const checkColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'purchase_receipts' AND column_name = 'status'
    `);
    
    if (checkColumn.rows.length === 0) {
      console.log('✅ Verified: Status column has been successfully removed from purchase_receipts table');
    } else {
      console.log('❌ Warning: Status column still exists in purchase_receipts table');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('📦 Database connection closed');
  }
}

// Run the migration
runMigration().catch(console.error);
