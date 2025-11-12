
const { Pool } = require('pg');

// Load environment variables
require('dotenv').config();

let DATABASE_URL = 
  process.env.EXTERNAL_DB_URL_Freshway ||
  process.env.EXTERNAL_DB_URL_hazkitchen ||
  process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

// Ensure SSL settings for external server
if (DATABASE_URL?.includes("1.55.212.135")) {
  if (!DATABASE_URL.includes("sslmode=disable")) {
    DATABASE_URL += DATABASE_URL.includes("?")
      ? "&sslmode=disable"
      : "?sslmode=disable";
  }
}

async function checkAndFixPrinterTable() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: DATABASE_URL?.includes("1.55.212.135")
      ? false
      : DATABASE_URL?.includes("neon")
        ? { rejectUnauthorized: false }
        : undefined,
  });
  
  try {
    console.log('Checking printer_configs table structure...');
    
    // Check current table structure
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'printer_configs'
      ORDER BY ordinal_position;
    `);
    
    console.log('Current columns:', tableInfo.rows.map(r => r.column_name));
    
    const existingColumns = tableInfo.rows.map(r => r.column_name);
    
    // Add missing columns one by one
    if (!existingColumns.includes('is_employee')) {
      console.log('Adding is_employee column...');
      await pool.query('ALTER TABLE printer_configs ADD COLUMN is_employee BOOLEAN NOT NULL DEFAULT false');
    }
    
    if (!existingColumns.includes('is_kitchen')) {
      console.log('Adding is_kitchen column...');
      await pool.query('ALTER TABLE printer_configs ADD COLUMN is_kitchen BOOLEAN NOT NULL DEFAULT false');
    }
    
    if (!existingColumns.includes('is_active')) {
      console.log('Adding is_active column...');
      await pool.query('ALTER TABLE printer_configs ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true');
    }
    
    // Migrate existing data if old columns exist
    if (existingColumns.includes('is_primary')) {
      console.log('Migrating is_primary to is_employee...');
      await pool.query('UPDATE printer_configs SET is_employee = is_primary WHERE is_primary = true');
    }
    
    if (existingColumns.includes('is_secondary')) {
      console.log('Migrating is_secondary to is_kitchen...');
      await pool.query('UPDATE printer_configs SET is_kitchen = is_secondary WHERE is_secondary = true');
    }
    
    // Drop old columns if they exist
    if (existingColumns.includes('is_primary')) {
      console.log('Dropping is_primary column...');
      await pool.query('ALTER TABLE printer_configs DROP COLUMN is_primary');
    }
    
    if (existingColumns.includes('is_secondary')) {
      console.log('Dropping is_secondary column...');
      await pool.query('ALTER TABLE printer_configs DROP COLUMN is_secondary');
    }
    
    console.log('Printer configs table structure updated successfully!');
    
    // Show final structure
    const finalTableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'printer_configs'
      ORDER BY ordinal_position;
    `);
    
    console.log('Final columns:', finalTableInfo.rows.map(r => r.column_name));
    
  } catch (error) {
    console.error('Failed to check/fix printer table:', error);
  } finally {
    await pool.end();
  }
}

checkAndFixPrinterTable();
