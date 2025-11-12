
const { Pool } = require("pg");

// Load environment variables
require("dotenv").config();

let DATABASE_URL = process.env.EXTERNAL_DB_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

// Ensure SSL settings for external server
if (DATABASE_URL?.includes("1.55.212.135")) {
  if (!DATABASE_URL.includes("sslmode=disable")) {
    DATABASE_URL += DATABASE_URL.includes("?")
      ? "&sslmode=disable"
      : "?sslmode=disable";
  }
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes("1.55.212.135")
    ? false
    : DATABASE_URL?.includes("neon")
      ? { rejectUnauthorized: false }
      : undefined,
});

async function fixStoreSettingsSchema() {
  const client = await pool.connect();
  
  try {
    console.log("🔍 Checking store_settings table schema...");
    
    // Check current columns
    const columnsResult = await client.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'store_settings' 
      ORDER BY column_name
    `);
    
    console.log("📋 Current columns:", columnsResult.rows);
    
    // Check if created_at column exists
    const hasCreatedAt = columnsResult.rows.some(row => row.column_name === 'created_at');
    const hasUpdatedAt = columnsResult.rows.some(row => row.column_name === 'updated_at');
    
    if (!hasCreatedAt) {
      console.log("➕ Adding created_at column...");
      await client.query(`
        ALTER TABLE store_settings 
        ADD COLUMN created_at TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      `);
      console.log("✅ Added created_at column");
    }
    
    if (!hasUpdatedAt) {
      console.log("➕ Adding updated_at column...");
      await client.query(`
        ALTER TABLE store_settings 
        ADD COLUMN updated_at TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      `);
      console.log("✅ Added updated_at column");
    }
    
    // Ensure other required columns exist
    const requiredColumns = [
      { name: 'zone_prefix', type: 'TEXT', default: "'구역'" },
      { name: 'default_floor', type: 'TEXT', default: "'1'" },
      { name: 'floor_prefix', type: 'TEXT', default: "'층'" }
    ];
    
    for (const col of requiredColumns) {
      const hasColumn = columnsResult.rows.some(row => row.column_name === col.name);
      if (!hasColumn) {
        console.log(`➕ Adding ${col.name} column...`);
        await client.query(`
          ALTER TABLE store_settings 
          ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}
        `);
        console.log(`✅ Added ${col.name} column`);
      }
    }
    
    // Remove enable_multi_floor if it exists
    const hasEnableMultiFloor = columnsResult.rows.some(row => row.column_name === 'enable_multi_floor');
    if (hasEnableMultiFloor) {
      console.log("🗑️ Removing enable_multi_floor column...");
      await client.query(`ALTER TABLE store_settings DROP COLUMN enable_multi_floor`);
      console.log("✅ Removed enable_multi_floor column");
    }
    
    // Update existing records with default values
    await client.query(`
      UPDATE store_settings 
      SET 
        created_at = COALESCE(created_at, to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        updated_at = COALESCE(updated_at, to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        default_floor = COALESCE(default_floor, '1'),
        floor_prefix = COALESCE(floor_prefix, '층'),
        zone_prefix = COALESCE(zone_prefix, '구역')
    `);
    
    console.log("✅ Updated existing records with default values");
    
    // Show final schema
    const finalSchema = await client.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'store_settings' 
      ORDER BY column_name
    `);
    
    console.log("📋 Final store_settings schema:");
    finalSchema.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (default: ${row.column_default || 'NULL'})`);
    });
    
    console.log("🎉 Store settings schema fixed successfully!");
    
  } catch (error) {
    console.error("❌ Error fixing store settings schema:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixStoreSettingsSchema()
  .then(() => {
    console.log("✅ Database schema fix completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Database schema fix failed:", error);
    process.exit(1);
  });
