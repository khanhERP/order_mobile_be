
const { db } = require('./db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('🔧 Running precision increase migration...');
    
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'increase_purchase_receipt_precision.sql'),
      'utf8'
    );
    
    await db.execute(migrationSQL);
    
    console.log('✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
