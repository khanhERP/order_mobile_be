
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting purchase receipts migration...');
    
    // Read the migration SQL file
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'migrate_to_purchase_receipts.sql'),
      'utf8'
    );
    
    // Begin transaction
    await client.query('BEGIN');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Commit transaction
    await client.query('COMMIT');
    
    console.log('✅ Purchase receipts migration completed successfully!');
    console.log('📋 Changes made:');
    console.log('   - purchase_orders → purchase_receipts');
    console.log('   - purchase_order_items → purchase_receipt_items');
    console.log('   - purchase_order_documents → purchase_receipt_documents');
    console.log('   - Updated foreign key column names');
    console.log('   - Recreated indexes with new names');
    
  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('🎉 Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };
