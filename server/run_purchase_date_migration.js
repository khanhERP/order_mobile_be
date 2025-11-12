
import { Client } from 'pg';
import fs from 'fs';

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('📦 Connected to database');

    // Read the migration SQL file
    const migrationSQL = fs.readFileSync('./rename_expected_delivery_date_to_purchase_date.sql', 'utf8');
    
    // Execute the migration
    await client.query(migrationSQL);
    console.log('✅ Successfully executed purchase date migration');

  } catch (error) {
    console.error('❌ Error running migration:', error);
  } finally {
    await client.end();
    console.log('📦 Database connection closed');
  }
}

runMigration();
