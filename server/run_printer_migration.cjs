
const { Pool } = require('pg');
const fs = require('fs');

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

async function runMigration() {
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
    console.log('Running printer config migration...');
    
    // Read and execute the migration
    const migrationSQL = fs.readFileSync('./update_printer_config_fields.sql', 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = migrationSQL.split(';').filter(s => s.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.trim());
        await pool.query(statement.trim());
      }
    }
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await pool.end();
  }
}

runMigration();
