// @ts-nocheck
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import {
  categories,
  products,
  employees,
  tables,
  orders,
  orderItems,
  transactions,
  transactionItems,
  attendanceRecords,
  storeSettings,
  suppliers,
  customers,
} from "@shared/schema";
import { sql } from "drizzle-orm";

// Load environment variables from .env file with higher priority
import { config } from "dotenv";
import path from "path";

// Load .env.local first, then override with .env to ensure .env has priority
config({ path: path.resolve(".env.local") });
config({ path: path.resolve(".env") });

// Multi-tenant database configuration
interface TenantConfig {
  subdomain: string;
  databaseUrl: string;
  storeName: string;
  isActive: boolean;
}

class DatabaseManager {
  private pools: Map<string, Pool> = new Map();
  private dbs: Map<string, any> = new Map();
  private defaultPool: Pool;
  private defaultDb: any;

  constructor() {
    // Initialize default database connection
    let DATABASE_URL = process.env.EXTERNAL_DB_URL || process.env.DATABASE_URL;

    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }

    // Ensure we're using the correct database and SSL settings for external server
    if (DATABASE_URL?.includes("1.55.212.135")) {
      if (!DATABASE_URL.includes("sslmode=disable")) {
        DATABASE_URL += DATABASE_URL.includes("?")
          ? "&sslmode=disable"
          : "?sslmode=disable";
      }
    }

    // Create default pool
    this.defaultPool = new Pool({
      connectionString: DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: DATABASE_URL?.includes("1.55.212.135")
        ? false // Disable SSL for external server
        : DATABASE_URL?.includes("neon")
          ? { rejectUnauthorized: false }
          : undefined,
    });

    this.defaultDb = drizzle(this.defaultPool, { schema });

    // Log database connection info
    console.log("🔍 Multi-tenant Database Manager initialized");
    console.log(
      "  - Default DATABASE_URL preview:",
      DATABASE_URL?.substring(0, 50) + "...",
    );

    // Test default database connection
    this.testDefaultConnection();

    // Initialize tenant databases
    this.initializeTenantDatabases();
  }

  private async testDefaultConnection() {
    try {
      const result = await this.defaultPool.query(
        "SELECT current_database(), current_user, version()",
      );
      console.log("✅ Default database connection successful:");
      console.log("  - Database:", result.rows[0]?.current_database);
      console.log("  - User:", result.rows[0]?.current_user);
      console.log(
        "  - Version:",
        result.rows[0]?.version?.substring(0, 50) + "...",
      );
    } catch (err) {
      console.error("❌ Default database connection failed:", err);
    }
  }

  private initializeTenantDatabases() {
    // Load tenant configurations
    const tenantConfigs: TenantConfig[] = [
      {
        subdomain: "demo",
        databaseUrl: process.env.EXTERNAL_DB_URL || process.env.DATABASE_URL!,
        storeName: "Store 0 - Cửa hàng demo",
        isActive: true,
      },
      {
        subdomain: "orders",
        databaseUrl: process.env.EXTERNAL_DB_URL || process.env.DATABASE_URL!,
        storeName: "Store 0 - Cửa hàng demo",
        isActive: true,
      },
      {
        subdomain: "0318225421",
        databaseUrl: process.env.EXTERNAL_DB_URL || process.env.DATABASE_URL!,
        storeName: "Store 1 - Cửa hàng 0318225421",
        isActive: true,
      },
      {
        subdomain: "0111156080",
        databaseUrl:
          process.env.DATABASE_0111156080 ||
          process.env.EXTERNAL_DB_0111156080 ||
          process.env.DATABASE_URL!,
        storeName: "Store 2 - Cửa hàng 0111156080",
        isActive: true,
      },
      {
        subdomain: "hazkitchen-mobie",
        databaseUrl:
          process.env.DATABASE_hazkitchen ||
          process.env.EXTERNAL_DB_hazkitchen!,
        storeName: "Store 3 - Cửa hàng hazkitchen",
        isActive: true,
      },
      {
        subdomain: "hazkitchen-mobile",
        databaseUrl:
          process.env.DATABASE_hazkitchen ||
          process.env.EXTERNAL_DB_hazkitchen!,
        storeName: "Store 3 - Cửa hàng hazkitchen",
        isActive: true,
      },
      {
        subdomain: "0108670987-001",
        databaseUrl:
          process.env.DATABASE_0108670987 ||
          process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987",
        isActive: true,
      },
      {
        subdomain: "0318225421-mobile",
        databaseUrl:
          process.env.DATABASE_URL_MOBIE || process.env.EXTERNAL_DB_URL_MOBIE!,
        storeName: "Store 6 - Cửa hàng 0318225421-mobile",
        isActive: true,
      },
      {
        subdomain: "0108670987-001-mobile",
        databaseUrl:
          process.env.DATABASE_0108670987 ||
          process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-002-mobile",
        databaseUrl:
          process.env.DATABASE_0108670987 ||
          process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-003-mobile",
        databaseUrl:
          process.env.DATABASE_010867098 || process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-004-mobile",
        databaseUrl:
          process.env.DATABASE_0108670987 ||
          process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-005-mobile",
        databaseUrl:
          process.env.DATABASE_0108670987 ||
          process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-006-mobile",
        databaseUrl:
          process.env.DATABASE_0108670987 ||
          process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-007-mobile",
        databaseUrl:
          process.env.DATABASE_0108670987 ||
          process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-008-mobile",
        databaseUrl:
          process.env.DATABASE_0108670987 ||
          process.env.EXTERNAL_DB_0108670987!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-001-mobile2",
        databaseUrl:
          process.env.DATABASE_0108670987_001 ||
          process.env.EXTERNAL_DB_0108670987_001!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-002-mobile2",
        databaseUrl:
          process.env.DATABASE_0108670987_002 ||
          process.env.EXTERNAL_DB_0108670987_002!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-003-mobile2",
        databaseUrl:
          process.env.DATABASE_0108670987_003 ||
          process.env.EXTERNAL_DB_0108670987_003!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-004-mobile2",
        databaseUrl:
          process.env.DATABASE_0108670987_004 ||
          process.env.EXTERNAL_DB_0108670987_004!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-005-mobile2",
        databaseUrl:
          process.env.DATABASE_0108670987_005 ||
          process.env.EXTERNAL_DB_0108670987_005!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-006-mobile2",
        databaseUrl:
          process.env.DATABASE_0108670987_006 ||
          process.env.EXTERNAL_DB_0108670987_006!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-007-mobile2",
        databaseUrl:
          process.env.DATABASE_0108670987_007 ||
          process.env.EXTERNAL_DB_0108670987_007!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
      {
        subdomain: "0108670987-008-mobile2",
        databaseUrl:
          process.env.DATABASE_0108670987_008 ||
          process.env.EXTERNAL_DB_0108670987_008!,
        storeName: "Store 5 - Cửa hàng 0108670987-008",
        isActive: true,
      },
    ];

    // Initialize each tenant database
    tenantConfigs.forEach((config) => {
      try {
        this.createTenantConnection(config.subdomain, config.databaseUrl);
        console.log(
          `✅ Tenant database initialized: ${config.subdomain} (${config.storeName})`,
        );
      } catch (error) {
        console.error(
          `❌ Failed to initialize tenant database: ${config.subdomain}`,
          error,
        );
      }
    });
  }

  private createTenantConnection(subdomain: string, databaseUrl: string) {
    // Ensure SSL settings for external server
    let finalDatabaseUrl = databaseUrl;
    if (finalDatabaseUrl?.includes("1.55.212.135")) {
      if (!finalDatabaseUrl.includes("sslmode=disable")) {
        finalDatabaseUrl += finalDatabaseUrl.includes("?")
          ? "&sslmode=disable"
          : "?sslmode=disable";
      }
    }

    const pool = new Pool({
      connectionString: finalDatabaseUrl,
      max: 10,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 10000,
      acquireTimeoutMillis: 10000,
      ssl: finalDatabaseUrl?.includes("1.55.212.135")
        ? false // Disable SSL for external server
        : finalDatabaseUrl?.includes("neon")
          ? { rejectUnauthorized: false }
          : undefined,
    });

    const db = drizzle(pool, { schema });

    this.pools.set(subdomain, pool);
    this.dbs.set(subdomain, db);

    return { pool, db };
  }

  // Get database connection for a specific tenant
  getTenantDatabase(subdomain: string) {
    const tenantDb = this.dbs.get(subdomain);
    if (!tenantDb) {
      console.warn(
        `⚠️ Tenant database not found for subdomain: ${subdomain}, using default`,
      );
      return this.defaultDb;
    }
    return tenantDb;
  }

  // Get pool for a specific tenant
  getTenantPool(subdomain: string) {
    const tenantPool = this.pools.get(subdomain);
    if (!tenantPool) {
      console.warn(
        `⚠️ Tenant pool not found for subdomain: ${subdomain}, using default`,
      );
      return this.defaultPool;
    }
    return tenantPool;
  }

  // Get default database (for backward compatibility)
  getDefaultDatabase() {
    return this.defaultDb;
  }

  // Get default pool (for backward compatibility)
  getDefaultPool() {
    return this.defaultPool;
  }

  // Add new tenant database at runtime
  async addTenantDatabase(subdomain: string, databaseUrl: string) {
    try {
      this.createTenantConnection(subdomain, databaseUrl);
      console.log(`✅ New tenant database added: ${subdomain}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to add tenant database: ${subdomain}`, error);
      return false;
    }
  }

  // Remove tenant database
  async removeTenantDatabase(subdomain: string) {
    try {
      const pool = this.pools.get(subdomain);
      if (pool) {
        await pool.end();
        this.pools.delete(subdomain);
        this.dbs.delete(subdomain);
        console.log(`✅ Tenant database removed: ${subdomain}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ Failed to remove tenant database: ${subdomain}`, error);
      return false;
    }
  }

  // Get all tenant subdomains
  getAllTenants() {
    return Array.from(this.dbs.keys());
  }

  // Health check for all databases
  async healthCheck() {
    const results = { default: false, tenants: {} as Record<string, boolean> };

    // Check default database
    try {
      await this.defaultPool.query("SELECT 1");
      results.default = true;
    } catch (error) {
      console.error("❌ Default database health check failed:", error);
    }

    // Check tenant databases
    for (const [subdomain, pool] of this.pools.entries()) {
      try {
        await pool.query("SELECT 1");
        results.tenants[subdomain] = true;
      } catch (error) {
        console.error(
          `❌ Tenant database health check failed for ${subdomain}:`,
          error,
        );
        results.tenants[subdomain] = false;
      }
    }

    return results;
  }
}

// Create global database manager instance
const dbManager = new DatabaseManager();

// Export default connections for backward compatibility
export const pool = dbManager.getDefaultPool();
export const db = dbManager.getDefaultDatabase();

// Export database manager for advanced usage
export { dbManager };

// Helper function to get tenant database
export function getTenantDatabase(subdomain: string) {
  return dbManager.getTenantDatabase(subdomain);
}

// Helper function to get tenant pool
export function getTenantPool(subdomain: string) {
  return dbManager.getTenantPool(subdomain);
}

// Function to check and add missing columns from schema
export async function checkAndAddMissingColumns() {
  console.log("🔍 Checking for missing columns in database...");

  // Define schema structure with table name, column name, type, and default
  const schemaColumns = [
    // Categories table
    {
      table: "categories",
      column: "name",
      type: "TEXT NOT NULL",
      default: "''",
      index: null,
    },
    {
      table: "categories",
      column: "icon",
      type: "TEXT NOT NULL",
      default: "'fa-folder'",
      index: null,
    },
    {
      table: "categories",
      column: "store_code",
      type: "VARCHAR(50)",
      default: null,
      index: "idx_categories_store_code",
    },

    // Products table
    {
      table: "products",
      column: "name",
      type: "TEXT NOT NULL",
      default: "''",
      index: null,
    },
    {
      table: "products",
      column: "sku",
      type: "TEXT",
      default: null,
      index: "idx_products_sku",
    },
    {
      table: "products",
      column: "price",
      type: "DECIMAL(18,2) NOT NULL",
      default: "0.00",
      index: null,
    },
    {
      table: "products",
      column: "stock",
      type: "INTEGER NOT NULL",
      default: "0",
      index: null,
    },
    {
      table: "products",
      column: "category_id",
      type: "INTEGER",
      default: null,
      index: "idx_products_category_id",
    },
    {
      table: "products",
      column: "image_url",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "products",
      column: "is_active",
      type: "BOOLEAN NOT NULL",
      default: "true",
      index: "idx_products_is_active",
    },
    {
      table: "products",
      column: "product_type",
      type: "INTEGER NOT NULL",
      default: "1",
      index: null,
    },
    {
      table: "products",
      column: "track_inventory",
      type: "BOOLEAN NOT NULL",
      default: "true",
      index: null,
    },
    {
      table: "products",
      column: "tax_rate",
      type: "DECIMAL(5,2) NOT NULL",
      default: "0.00",
      index: null,
    },
    {
      table: "products",
      column: "tax_rate_name",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "products",
      column: "price_includes_tax",
      type: "BOOLEAN NOT NULL",
      default: "false",
      index: null,
    },
    {
      table: "products",
      column: "after_tax_price",
      type: "DECIMAL(18,2)",
      default: null,
      index: null,
    },
    {
      table: "products",
      column: "before_tax_price",
      type: "DECIMAL(18,2)",
      default: null,
      index: "idx_products_before_tax_price",
    },
    {
      table: "products",
      column: "floor",
      type: "VARCHAR(50)",
      default: "'1'",
      index: "idx_products_floor",
    },
    {
      table: "products",
      column: "zone",
      type: "VARCHAR(50)",
      default: "'A'",
      index: "idx_products_zone",
    },
    {
      table: "products",
      column: "unit",
      type: "TEXT",
      default: "'Cái'",
      index: null,
    },
    {
      table: "products",
      column: "is_active",
      type: "BOOLEAN NOT NULL",
      default: "true",
      index: "idx_products_is_active",
    },
    {
      table: "products",
      column: "store_code",
      type: "VARCHAR(50)",
      default: null,
      index: "idx_products_store_code",
    },
    {
      table: "products",
      column: "sort",
      type: "INTEGER",
      default: "0",
      index: null,
    },

    // Store settings table
    {
      table: "store_settings",
      column: "store_name",
      type: "TEXT NOT NULL",
      default: "'EDPOS 레스토랑'",
      index: null,
    },
    {
      table: "store_settings",
      column: "store_code",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "domain",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "tax_id",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "price_list_id",
      type: "INTEGER",
      default: null,
      index: "idx_store_settings_price_list_id",
    },
    {
      table: "store_settings",
      column: "business_type",
      type: "TEXT",
      default: "'restaurant'",
      index: null,
    },
    {
      table: "store_settings",
      column: "pin_code",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "user_name",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "password",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "is_admin",
      type: "BOOLEAN",
      default: "false",
      index: null,
    },
    {
      table: "store_settings",
      column: "parent",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "type_user",
      type: "INTEGER",
      default: "0",
      index: null,
    },
    {
      table: "store_settings",
      column: "address",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "phone",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "email",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "store_settings",
      column: "open_time",
      type: "TEXT",
      default: "'09:00'",
      index: null,
    },
    {
      table: "store_settings",
      column: "close_time",
      type: "TEXT",
      default: "'22:00'",
      index: null,
    },
    {
      table: "store_settings",
      column: "gold_threshold",
      type: "TEXT",
      default: "'300000'",
      index: null,
    },
    {
      table: "store_settings",
      column: "vip_threshold",
      type: "TEXT",
      default: "'1000000'",
      index: null,
    },
    {
      table: "store_settings",
      column: "price_includes_tax",
      type: "BOOLEAN",
      default: "false",
      index: null,
    },
    {
      table: "store_settings",
      column: "default_floor",
      type: "TEXT",
      default: "'1'",
      index: null,
    },
    {
      table: "store_settings",
      column: "default_zone",
      type: "TEXT",
      default: "'A'",
      index: null,
    },
    {
      table: "store_settings",
      column: "floor_prefix",
      type: "TEXT",
      default: "'층'",
      index: null,
    },
    {
      table: "store_settings",
      column: "zone_prefix",
      type: "TEXT",
      default: "'구역'",
      index: null,
    },
    {
      table: "store_settings",
      column: "is_edit",
      type: "BOOLEAN NOT NULL",
      default: "false",
      index: null,
    },
    {
      table: "store_settings",
      column: "is_cancelled",
      type: "BOOLEAN NOT NULL",
      default: "false",
      index: null,
    },
    {
      table: "store_settings",
      column: "created_at",
      type: "TIMESTAMPTZ",
      default: "NOW()",
      index: null,
    },
    {
      table: "store_settings",
      column: "updated_at",
      type: "TIMESTAMPTZ",
      default: "NOW()",
      index: null,
    },

    // Orders table
    {
      table: "orders",
      column: "order_number",
      type: "TEXT",
      default: null,
      index: "idx_orders_order_number",
    },
    {
      table: "orders",
      column: "table_id",
      type: "INTEGER",
      default: null,
      index: "idx_orders_table_id",
    },
    {
      table: "orders",
      column: "employee_id",
      type: "INTEGER",
      default: null,
      index: null,
    },
    {
      table: "orders",
      column: "customer_id",
      type: "INTEGER",
      default: null,
      index: "idx_orders_customer_id",
    },
    {
      table: "orders",
      column: "status",
      type: "TEXT NOT NULL",
      default: "'pending'",
      index: "idx_orders_status",
    },
    {
      table: "orders",
      column: "customer_name",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "orders",
      column: "customer_phone",
      type: "TEXT",
      default: null,
      index: "idx_orders_customer_phone",
    },
    {
      table: "orders",
      column: "customer_tax_code",
      type: "TEXT",
      default: null,
      index: "idx_orders_customer_tax_code",
    },
    {
      table: "orders",
      column: "customer_count",
      type: "INTEGER",
      default: "1",
      index: null,
    },
    {
      table: "orders",
      column: "subtotal",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: null,
    },
    {
      table: "orders",
      column: "tax",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: null,
    },
    {
      table: "orders",
      column: "discount",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: "idx_orders_discount",
    },
    {
      table: "orders",
      column: "total",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: null,
    },
    {
      table: "orders",
      column: "payment_method",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "orders",
      column: "payment_status",
      type: "TEXT NOT NULL",
      default: "'pending'",
      index: null,
    },
    {
      table: "orders",
      column: "is_paid",
      type: "BOOLEAN NOT NULL",
      default: "false",
      index: "idx_orders_is_paid",
    },
    {
      table: "orders",
      column: "einvoice_status",
      type: "INTEGER NOT NULL",
      default: "0",
      index: null,
    },
    {
      table: "orders",
      column: "template_number",
      type: "VARCHAR(50)",
      default: null,
      index: "idx_orders_template_number",
    },
    {
      table: "orders",
      column: "symbol",
      type: "VARCHAR(20)",
      default: null,
      index: "idx_orders_symbol",
    },
    {
      table: "orders",
      column: "invoice_number",
      type: "VARCHAR(50)",
      default: null,
      index: "idx_orders_invoice_number",
    },
    {
      table: "orders",
      column: "sales_channel",
      type: "TEXT NOT NULL",
      default: "'table'",
      index: "idx_orders_sales_channel",
    },
    {
      table: "orders",
      column: "price_include_tax",
      type: "BOOLEAN NOT NULL",
      default: "false",
      index: "idx_orders_price_include_tax",
    },
    {
      table: "orders",
      column: "notes",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "orders",
      column: "store_code",
      type: "VARCHAR(50)",
      default: null,
      index: "idx_orders_store_code",
    },
    {
      table: "orders",
      column: "ordered_at",
      type: "TIMESTAMPTZ",
      default: "NOW()",
      index: null,
    },
    {
      table: "orders",
      column: "served_at",
      type: "TIMESTAMPTZ",
      default: null,
      index: null,
    },
    {
      table: "orders",
      column: "paid_at",
      type: "TIMESTAMPTZ",
      default: null,
      index: null,
    },
    {
      table: "orders",
      column: "created_at",
      type: "TIMESTAMPTZ",
      default: "NOW()",
      index: null,
    },
    {
      table: "orders",
      column: "updated_at",
      type: "TIMESTAMPTZ",
      default: "NOW()",
      index: null,
    },

    // Order items table
    {
      table: "order_items",
      column: "order_id",
      type: "INTEGER",
      default: null,
      index: null,
    },
    {
      table: "order_items",
      column: "product_id",
      type: "INTEGER",
      default: null,
      index: null,
    },
    {
      table: "order_items",
      column: "quantity",
      type: "NUMERIC(8,4) NOT NULL",
      default: "1",
      index: null,
    },
    {
      table: "order_items",
      column: "unit_price",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: null,
    },
    {
      table: "order_items",
      column: "total",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: null,
    },
    {
      table: "order_items",
      column: "discount",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: "idx_order_items_discount",
    },
    {
      table: "order_items",
      column: "tax",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: "idx_order_items_tax",
    },
    {
      table: "order_items",
      column: "price_before_tax",
      type: "DECIMAL(10,2) NOT NULL",
      default: "0.00",
      index: "idx_order_items_price_before_tax",
    },
    {
      table: "order_items",
      column: "status",
      type: "VARCHAR(50) NOT NULL",
      default: "'pending'",
      index: "idx_order_items_status",
    },
    {
      table: "order_items",
      column: "notes",
      type: "TEXT",
      default: null,
      index: null,
    },
    {
      table: "order_items",
      column: "store_code",
      type: "VARCHAR(50)",
      default: null,
      index: "idx_order_items_store_code",
    },
  ];

  let addedColumns = 0;
  let createdIndexes = 0;

  for (const {
    table,
    column,
    type,
    default: defaultValue,
    index,
  } of schemaColumns) {
    try {
      // Check if column exists
      const checkColumn = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = ${table}
        AND column_name = ${column}
      `);

      if (!checkColumn.rows || checkColumn.rows.length === 0) {
        // Column doesn't exist, add it
        const alterQuery = defaultValue
          ? `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type} DEFAULT ${defaultValue}`
          : `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`;

        await db.execute(sql.raw(alterQuery));
        console.log(`  ✅ Added column ${table}.${column}`);
        addedColumns++;
      }

      // Create index if specified and doesn't exist
      if (index) {
        const checkIndex = await db.execute(sql`
          SELECT indexname 
          FROM pg_indexes 
          WHERE schemaname = 'public' 
          AND tablename = ${table}
          AND indexname = ${index}
        `);

        if (!checkIndex.rows || checkIndex.rows.length === 0) {
          await db.execute(
            sql.raw(
              `CREATE INDEX IF NOT EXISTS ${index} ON ${table}(${column})`,
            ),
          );
          console.log(`  📊 Created index ${index} on ${table}.${column}`);
          createdIndexes++;
        }
      }
    } catch (error) {
      console.log(
        `  ⚠️ Error checking/adding ${table}.${column}:`,
        error.message,
      );
    }
  }

  console.log(
    `\n✅ Column check completed: ${addedColumns} columns added, ${createdIndexes} indexes created\n`,
  );
}

// Initialize sample data function
export async function initializeSampleData() {
  try {
    console.log("Running database migrations...");

    // Run the automatic column check first
    await checkAndAddMissingColumns();

    // Run migration for membership thresholds
    try {
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS gold_threshold TEXT DEFAULT '300000'
      `);
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS vip_threshold TEXT DEFAULT '1000000'
      `);

      // Update existing records
      await db.execute(sql`
        UPDATE store_settings 
        SET gold_threshold = COALESCE(gold_threshold, '300000'), 
            vip_threshold = COALESCE(vip_threshold, '1000000')
      `);

      console.log(
        "Migration for membership thresholds completed successfully.",
      );
    } catch (migrationError) {
      console.log("Migration already applied or error:", migrationError);
    }

    // Run migration for product_type column
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type INTEGER DEFAULT 1
      `);
      await db.execute(sql`
        UPDATE products SET product_type = 1 WHERE product_type IS NULL
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type)
      `);

      console.log("Migration for product_type column completed successfully.");
    } catch (migrationError) {
      console.log(
        "Product type migration already applied or error:",
        migrationError,
      );
    }

    // Run migration for tax_rate column
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) DEFAULT 0.00
      `);
      await db.execute(sql`
        UPDATE products SET tax_rate = 0.00 WHERE tax_rate IS NULL
      `);

      console.log("Migration for tax_rate column completed successfully.");
    } catch (migrationError) {
      console.log(
        "Tax rate migration already applied or error:",
        migrationError,
      );
    }

    // Run migration for price_includes_tax column
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS price_includes_tax BOOLEAN DEFAULT false
      `);
      await db.execute(sql`
        UPDATE products SET price_includes_tax = false WHERE price_includes_tax IS NULL
      `);

      console.log(
        "Migration for price_includes_tax column completed successfully.",
      );
    } catch (migrationError) {
      console.log(
        "Price includes tax migration already applied or error:",
        migrationError,
      );
    }

    // Run migration for after_tax_price column
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS after_tax_price DECIMAL(10,2)
      `);

      console.log(
        "Migration for after_tax_price column completed successfully.",
      );
    } catch (migrationError) {
      console.log(
        "After tax price migration already applied or error:",
        migrationError,
      );
    }

    // Run migration for pinCode column in store_settings
    try {
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS pin_code TEXT
      `);

      console.log("Migration for pinCode column completed successfully.");
    } catch (migrationError) {
      console.log(
        "PinCode migration already applied or error:",
        migrationError,
      );
    }

    // Add templateCode column to invoice_templates table
    try {
      await db.execute(sql`
        ALTER TABLE invoice_templates 
        ADD COLUMN IF NOT EXISTS template_code VARCHAR(50)
      `);
      console.log("Migration for templateCode column completed successfully.");
    } catch (error) {
      console.log(
        "TemplateCode migration failed or column already exists:",
        error,
      );
    }

    // Add trade_number column to invoices table and migrate data
    try {
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trade_number VARCHAR(50)
      `);

      // Copy data from invoice_number to trade_number
      await db.execute(sql`
        UPDATE invoices SET trade_number = invoice_number WHERE trade_number IS NULL OR trade_number = ''
      `);

      // Clear invoice_number column
      await db.execute(sql`
        UPDATE invoices SET invoice_number = NULL
      `);

      // Create index for trade_number
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoices_trade_number ON invoices(trade_number)
      `);

      console.log("Migration for trade_number column completed successfully.");
    } catch (error) {
      console.log("Trade number migration failed or already applied:", error);
    }

    // Add invoice_status column to invoices table
    try {
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_status INTEGER NOT NULL DEFAULT 1
      `);

      // Create index for invoice_status
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoices_invoice_status ON invoices(invoice_status)
      `);

      console.log(
        "Migration for invoice_status column in invoices completed successfully.",
      );
    } catch (error) {
      console.log(
        "Invoice status migration for invoices failed or already applied:",
        error,
      );
    }

    // Add invoice_status column to orders table
    try {
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_status INTEGER NOT NULL DEFAULT 1
      `);

      // Create index for invoice_status
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_invoice_status ON orders(invoice_status)
      `);

      console.log(
        "Migration for invoice_status column in orders completed successfully.",
      );
    } catch (error) {
      console.log(
        "Invoice status migration for orders failed or already applied:",
        error,
      );
    }

    // Add template_number and symbol columns to orders table
    try {
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS template_number VARCHAR(50)
      `);
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS symbol VARCHAR(20)
      `);

      // Create indexes for template_number and symbol
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_template_number ON orders(template_number)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol)
      `);

      console.log(
        "Migration for template_number and symbol columns in orders table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Template number and symbol migration failed or already applied:",
        error,
      );
    }

    // Add invoice_number column to orders table
    try {
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50)
      `);

      // Create index for invoice_number
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_invoice_number ON orders(invoice_number)
      `);

      console.log(
        "Migration for invoice_number column in orders table completed successfully.",
      );
    } catch (error) {
      console.log("Invoice number migration failed or already applied:", error);
    }

    // Add discount column to orders table
    try {
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);

      // Create index for discount
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_discount ON orders(discount)
      `);

      // Update existing orders to set discount to 0 if null
      await db.execute(sql`
        UPDATE orders SET discount = 0.00 WHERE discount IS NULL
      `);

      console.log(
        "Migration for discount column in orders table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Discount column migration failed or already applied:",
        error,
      );
    }

    // Add discount column to order_items table
    try {
      await db.execute(sql`
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);

      // Create index for discount
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_items_discount ON order_items(discount)
      `);

      // Update existing order items to set discount to 0 if null
      await db.execute(sql`
        UPDATE order_items SET discount = 0.00 WHERE discount IS NULL
      `);

      console.log(
        "Migration for discount column in order_items table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Order items discount column migration failed or already applied:",
        error,
      );
    }

    // Add status column to order_items table
    try {
      await db.execute(sql`
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending'
      `);

      // Create index for status
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status)
      `);

      // Update existing order items to set status to pending if null
      await db.execute(sql`
        UPDATE order_items SET status = 'pending' WHERE status IS NULL
      `);

      console.log(
        "Migration for status column in order_items table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Order items status column migration failed or already applied:",
        error,
      );
    }

    // Add tax column to order_items table
    try {
      await db.execute(sql`
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);

      // Create index for tax
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_items_tax ON order_items(tax)
      `);

      // Update existing order items to set tax to 0 if null
      await db.execute(sql`
        UPDATE order_items SET tax = 0.00 WHERE tax IS NULL
      `);

      console.log(
        "Migration for tax column in order_items table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Order items tax column migration failed or already applied:",
        error,
      );
    }

    // Add priceBeforeTax column to order_items table
    try {
      await db.execute(sql`
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_before_tax DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);

      // Create index for priceBeforeTax
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_items_price_before_tax ON order_items(price_before_tax)
      `);

      // Update existing order items to set priceBeforeTax to 0 if null
      await db.execute(sql`
        UPDATE order_items SET price_before_tax = 0.00 WHERE price_before_tax IS NULL
      `);

      console.log(
        "Migration for price_before_tax column in order_items table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Order items price_before_tax column migration failed or already applied:",
        error,
      );
    }

    // Update quantity column in order_items table to NUMERIC(8,4)
    try {
      await db.execute(sql`
        ALTER TABLE order_items 
        ALTER COLUMN quantity TYPE NUMERIC(8,4)
      `);

      console.log(
        "Migration for quantity column in order_items table to NUMERIC(8,4) completed successfully.",
      );
    } catch (error) {
      console.log(
        "Order items quantity column migration failed or already applied:",
        error,
      );
    }

    // Add price_include_tax column to orders table
    try {
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_include_tax BOOLEAN NOT NULL DEFAULT false
      `);

      // Create index for price_include_tax
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_price_include_tax ON orders(price_include_tax)
      `);

      // Update existing orders to set price_include_tax based on store_settings
      await db.execute(sql`
        UPDATE orders 
        SET price_include_tax = (
          SELECT COALESCE(price_includes_tax, false) 
          FROM store_settings 
          LIMIT 1
        ) 
        WHERE price_include_tax IS NULL OR price_include_tax = false
      `);

      console.log(
        "Migration for price_include_tax column in orders table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Orders price_include_tax column migration failed or already applied:",
        error,
      );
    }

    // Add before_tax_price column to products table
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS before_tax_price DECIMAL(18,2)
      `);

      // Create index for before_tax_price
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_products_before_tax_price ON products(before_tax_price)
      `);

      console.log(
        "Migration for before_tax_price column in products table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Products before_tax_price column migration failed or already applied:",
        error,
      );
    }

    // Add tax_rate_name column to products table
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_rate_name TEXT
      `);

      // Update existing products with tax_rate_name based on their tax_rate
      await db.execute(sql`
        UPDATE products 
        SET tax_rate_name = CASE 
          WHEN tax_rate = '0' OR tax_rate IS NULL THEN '0%'
          WHEN tax_rate::numeric = 0 THEN '0%'
          ELSE tax_rate || '%'
        END
        WHERE tax_rate_name IS NULL
      `);

      console.log(
        "Migration for tax_rate_name column in products table completed successfully.",
      );
    } catch (error) {
      console.log(
        "Products tax_rate_name column migration failed or already applied:",
        error,
      );
    }

    // Ensure floor column exists in products
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS floor VARCHAR(50) DEFAULT '1층'
      `);

      // Update existing products
      await db.execute(sql`
        UPDATE products SET floor = '1층' WHERE floor IS NULL
      `);
      console.log("✅ Floor column added to products successfully");
    } catch (error) {
      console.log(
        "ℹ️ Floor column already exists or migration completed:",
        error.message,
      );
    }

    // Ensure zone column exists in products
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS zone VARCHAR(50) DEFAULT 'A구역'
      `);

      // Update existing products
      await db.execute(sql`
        UPDATE products SET zone = 'A구역' WHERE zone IS NULL
      `);
      console.log("✅ Zone column added to products successfully");
    } catch (error) {
      console.log(
        "ℹ️ Zone column already exists or migration completed:",
        error.message,
      );
    }

    // Ensure unit column exists in products
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'Cái'
      `);

      // Update existing products to have default unit if NULL
      await db.execute(sql`
        UPDATE products SET unit = 'Cái' WHERE unit IS NULL
      `);
      console.log("✅ Unit column added to products successfully");
    } catch (error) {
      console.log(
        "ℹ️ Unit column already exists or migration completed:",
        error.message,
      );
    }

    // Add isActive column to products table if it doesn't exist
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
      `);

      // Create index for better query performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active)
      `);

      // Update existing products to set is_active to true if null
      await db.execute(sql`
        UPDATE products SET is_active = true WHERE is_active IS NULL
      `);
      console.log("✅ isActive column added to products successfully");
    } catch (error) {
      console.log(
        "ℹ️ isActive column already exists or migration completed:",
        error.message,
      );
    }

    // Initialize order_change_history table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS order_change_history (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          order_number VARCHAR(100),
          changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ip_address VARCHAR(255) NOT NULL,
          user_id INTEGER,
          user_name VARCHAR(255) NOT NULL,
          action VARCHAR(50) NOT NULL DEFAULT 'edit',
          detailed_description TEXT NOT NULL,
          store_code VARCHAR(50),
          store_name VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // Ensure order_number column exists (migration for existing tables)
      await db.execute(sql`
        ALTER TABLE order_change_history 
        ADD COLUMN IF NOT EXISTS order_number VARCHAR(100)
      `);

      // Ensure store_name column exists (migration for existing tables)
      await db.execute(sql`
        ALTER TABLE order_change_history 
        ADD COLUMN IF NOT EXISTS store_name VARCHAR(255)
      `);

      // Add isEdit and isCancelled columns to store_settings
      try {
        await db.execute(sql`
          ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS is_edit BOOLEAN NOT NULL DEFAULT false
        `);
        await db.execute(sql`
          ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT false
        `);

        // Update existing records to have default values
        await db.execute(sql`
          UPDATE store_settings 
          SET is_edit = COALESCE(is_edit, false),
              is_cancelled = COALESCE(is_cancelled, false)
          WHERE is_edit IS NULL OR is_cancelled IS NULL
        `);

        console.log(
          "✅ isEdit and isCancelled columns added to store_settings successfully",
        );
      } catch (error) {
        console.log(
          "ℹ️ isEdit and isCancelled columns already exist or migration completed:",
          error.message,
        );
      }

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_change_history_order_id ON order_change_history(order_id)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_change_history_changed_at ON order_change_history(changed_at)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_change_history_store_code ON order_change_history(store_code)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_change_history_order_number ON order_change_history(order_number)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_order_change_history_store_name ON order_change_history(store_name)
      `);

      console.log("✅ Order change history table initialized successfully");
    } catch (error) {
      console.log(
        "ℹ️ Order change history table already exists or initialization failed:",
        error,
      );
    }

    // Add customer phone and tax code to orders table
    try {
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT
      `);
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_tax_code TEXT
      `);

      // Create indexes for better search performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_customer_tax_code ON orders(customer_tax_code)
      `);

      console.log(
        "✅ Customer phone and tax code columns added to orders successfully",
      );
    } catch (error) {
      console.log(
        "ℹ️ Customer info columns already exist or migration completed:",
        error.message,
      );
    }

    // Add customerId to orders table
    try {
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)
      `);

      // Create index for better query performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id)
      `);

      // Update existing orders to link with customers based on phone number
      await db.execute(sql`
        UPDATE orders o
        SET customer_id = c.id
        FROM customers c
        WHERE o.customer_phone IS NOT NULL 
          AND c.phone IS NOT NULL
          AND o.customer_phone = c.phone
          AND o.customer_id IS NULL
      `);

      console.log("✅ customerId column added to orders table successfully");
    } catch (error) {
      console.log(
        "ℹ️ customerId column already exists or migration completed:",
        error.message,
      );
    }

    // Add customer phone and tax code to orders table
    try {
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT
      `);
      await db.execute(sql`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_tax_code TEXT
      `);

      // Create indexes for better search performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_orders_customer_tax_code ON orders(customer_tax_code)
      `);

      console.log(
        "✅ Customer phone and tax code columns added to orders successfully",
      );
    } catch (error) {
      console.log(
        "ℹ️ Customer info columns already exist or migration completed:",
        error.message,
      );
    }

    // Add domain column to store_settings
    try {
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS domain TEXT
      `);

      console.log("✅ Domain column added to store_settings successfully");
    } catch (error) {
      console.log(
        "ℹ️ Domain column already exists or migration completed:",
        error.message,
      );
    }

    // Add isEdit and isCancelled columns to store_settings
    try {
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS is_edit BOOLEAN NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT false
      `);

      // Update existing records to have default values
      await db.execute(sql`
        UPDATE store_settings 
        SET is_edit = COALESCE(is_edit, false),
            is_cancelled = COALESCE(is_cancelled, false)
        WHERE is_edit IS NULL OR is_cancelled IS NULL
      `);

      console.log(
        "✅ isEdit and isCancelled columns added to store_settings successfully",
      );
    } catch (error) {
      console.log(
        "ℹ️ isEdit and isCancelled columns already exist or migration completed:",
        error.message,
      );
    }

    // Add storeCode column to all tables for multi-tenant support
    try {
      console.log("🔄 Adding storeCode column to all tables...");

      const tablesToUpdate = [
        "categories",
        "products",
        "transactions",
        "transaction_items",
        "employees",
        "attendance_records",
        "tables",
        "orders",
        "order_items",
        "suppliers",
        "customers",
        "point_transactions",
        "inventory_transactions",
        "invoices",
        "invoice_items",
        "einvoice_connections",
        "printer_configs",
        "invoice_templates",
        "purchase_receipts",
        "purchase_receipt_items",
        "purchase_receipt_documents",
        "income_vouchers",
        "expense_vouchers",
        "payment_methods",
      ];

      for (const table of tablesToUpdate) {
        try {
          await db.execute(
            sql.raw(`
            ALTER TABLE ${table} 
            ADD COLUMN IF NOT EXISTS store_code VARCHAR(50)
          `),
          );

          // Create index for better query performance
          await db.execute(
            sql.raw(`
            CREATE INDEX IF NOT EXISTS idx_${table}_store_code 
            ON ${table}(store_code)
          `),
          );

          console.log(`  ✅ Added storeCode to ${table}`);
        } catch (tableError) {
          console.log(
            `  ℹ️ storeCode already exists in ${table} or error:`,
            tableError.message,
          );
        }
      }

      console.log("✅ storeCode column migration completed successfully");
    } catch (error) {
      console.log("⚠️ storeCode migration error:", error);
    }

    // Add isPaid column to orders table
    try {
      // Check if column already exists
      const columnCheck = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'orders' 
        AND column_name = 'is_paid'
      `);

      const columnExists = columnCheck.rows && columnCheck.rows.length > 0;

      if (!columnExists) {
        // Only add column and update data if it doesn't exist
        await db.execute(sql`
          ALTER TABLE orders ADD COLUMN is_paid BOOLEAN NOT NULL DEFAULT false
        `);

        // Create index for better query performance
        await db.execute(sql`
          CREATE INDEX IF NOT EXISTS idx_orders_is_paid ON orders(is_paid)
        `);

        // Only update existing records when column is first created
        await db.execute(sql`
          UPDATE orders SET is_paid = true WHERE payment_status = 'paid'
        `);

        console.log("✅ isPaid column added to orders table successfully");
      } else {
        console.log("ℹ️ isPaid column already exists, skipping migration");
      }
    } catch (error) {
      console.log(
        "ℹ️ isPaid migration error or already completed:",
        error.message,
      );
    }

    // Run migration for email constraint in employees table
    try {
      await db.execute(sql`
        ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_email_unique
      `);

      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS employees_email_unique_idx 
        ON employees (email) 
        WHERE email IS NOT NULL AND email != ''
      `);

      await db.execute(sql`
        UPDATE employees SET email = NULL WHERE email = ''
      `);

      console.log(
        "Migration for employees email constraint completed successfully.",
      );
    } catch (migrationError) {
      console.log(
        "Email constraint migration already applied or error:",
        migrationError,
      );
    }

    // Skip sample data initialization - using external database
    console.log("🔍 Checking customer table data...");
    const customerCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers);
    console.log(
      `📊 Found ${customerCount[0]?.count || 0} customers in database`,
    );

    // Note: Sample data insertion disabled for external database
    console.log("ℹ️ Sample data insertion skipped - using external database");

    // Add notes column to transactions table if it doesn't exist
    try {
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT
      `);
      console.log(
        "Migration for notes column in transactions table completed successfully.",
      );
    } catch (migrationError) {
      console.log(
        "Notes column migration already applied or error:",
        migrationError,
      );
    }

    // Add invoice_id and invoice_number columns to transactions table if they don't exist
    try {
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id)
      `);
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50)
      `);
      console.log(
        "Migration for invoice_id and invoice_number columns in transactions table completed successfully.",
      );
    } catch (migrationError) {
      console.log(
        "Invoice columns migration already applied or error:",
        migrationError,
      );
    }

    // Initialize inventory_transactions table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS inventory_transactions (
          id SERIAL PRIMARY KEY,
          product_id INTEGER REFERENCES products(id) NOT NULL,
          type VARCHAR(20) NOT NULL,
          quantity INTEGER NOT NULL,
          previous_stock INTEGER NOT NULL,
          new_stock INTEGER NOT NULL,
          notes TEXT,
          created_at VARCHAR(50) NOT NULL
        )
      `);
      console.log("Inventory transactions table initialized");
    } catch (error) {
      console.log(
        "Inventory transactions table already exists or initialization failed:",
        error,
      );
    }

    // Initialize einvoice_connections table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS einvoice_connections (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(10) NOT NULL,
          tax_code VARCHAR(20) NOT NULL,
          login_id VARCHAR(50) NOT NULL,
          password TEXT NOT NULL,
          software_name VARCHAR(50) NOT NULL,
          login_url TEXT,
          sign_method VARCHAR(20) NOT NULL DEFAULT 'Ký server',
          cqt_code VARCHAR(20) NOT NULL DEFAULT 'Cấp nhật',
          notes TEXT,
          is_default BOOLEAN NOT NULL DEFAULT false,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_einvoice_connections_symbol ON einvoice_connections(symbol)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_einvoice_connections_active ON einvoice_connections(is_active)
      `);

      console.log("E-invoice connections table initialized");
    } catch (error) {
      console.log(
        "E-invoice connections table already exists or initialization failed:",
        error,
      );
    }

    // Initialize invoice_templates table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS invoice_templates (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          template_number VARCHAR(50) NOT NULL,
          template_code VARCHAR(50),
          symbol VARCHAR(20) NOT NULL,
          use_ck BOOLEAN NOT NULL DEFAULT true,
          notes TEXT,
          is_default BOOLEAN NOT NULL DEFAULT false,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoice_templates_symbol ON invoice_templates(symbol)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoice_templates_default ON invoice_templates(is_default)
      `);

      console.log("Invoice templates table initialized");
    } catch (error) {
      console.log(
        "Invoice templates table already exists or initialization failed:",
        error,
      );
    }

    // Initialize invoices table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS invoices (
          id SERIAL PRIMARY KEY,
          invoice_number VARCHAR(50) UNIQUE NOT NULL,
          customer_id INTEGER,
          customer_name VARCHAR(100) NOT NULL,
          customer_tax_code VARCHAR(20),
          customer_address TEXT,
          customer_phone VARCHAR(20),
          customer_email VARCHAR(100),
          subtotal DECIMAL(10, 2) NOT NULL,
          tax DECIMAL(10, 2) NOT NULL,
          total DECIMAL(10, 2) NOT NULL,
          payment_method VARCHAR(50) NOT NULL,
          invoice_date TIMESTAMP NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'draft',
          einvoice_status INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)
      `);

      console.log("Invoices table initialized");
    } catch (error) {
      console.log(
        "Invoices table already exists or initialization failed:",
        error,
      );
    }

    // Initialize printer_configs table if it doesn't exist
    try {
      // Check if table exists first
      const tableExists = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'printer_configs'
        )
      `);

      if (!tableExists.rows[0]?.exists) {
        await db.execute(sql`
          CREATE TABLE printer_configs (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            printer_type VARCHAR(50) NOT NULL DEFAULT 'thermal',
            connection_type VARCHAR(50) NOT NULL DEFAULT 'usb',
            ip_address VARCHAR(45),
            port INTEGER DEFAULT 9100,
            mac_address VARCHAR(17),
            paper_width INTEGER NOT NULL DEFAULT 80,
            print_speed INTEGER DEFAULT 100,
            is_primary BOOLEAN NOT NULL DEFAULT false,
            is_secondary BOOLEAN NOT NULL DEFAULT false,
            is_active BOOLEAN NOT NULL DEFAULT true,
            copies INTEGER NOT NULL DEFAULT 0,
            floor VARCHAR(50) DEFAULT '1',
            zone VARCHAR(50) DEFAULT 'A',
            created_at TIMESTAMP DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMP DEFAULT NOW() NOT NULL
          )
        `);

        // Create indexes for better performance
        await db.execute(sql`
          CREATE INDEX idx_printer_configs_primary ON printer_configs(is_primary)
        `);
        await db.execute(sql`
          CREATE INDEX idx_printer_configs_active ON printer_configs(is_active)
        `);
        await db.execute(sql`
          CREATE INDEX idx_printer_configs_floor ON printer_configs(floor)
        `);

        console.log("Printer configs table created successfully");
      } else {
        // Add missing columns if table exists
        try {
          await db.execute(sql`
            ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false
          `);
          await db.execute(sql`
            ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS is_secondary BOOLEAN DEFAULT false
          `);
          await db.execute(sql`
            ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS copies INTEGER DEFAULT 0
          `);
          await db.execute(sql`
            ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS floor VARCHAR(50) DEFAULT '1'
          `);
          await db.execute(sql`
            ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS zone VARCHAR(50) DEFAULT 'A'
          `);

          // Update existing records to have default values
          await db.execute(sql`
            UPDATE printer_configs SET copies = 0 WHERE copies IS NULL
          `);
          await db.execute(sql`
            UPDATE printer_configs SET floor = '1' WHERE floor IS NULL
          `);
          await db.execute(sql`
            UPDATE printer_configs SET zone = 'A' WHERE zone IS NULL
          `);

          // Create index for floor if not exists
          await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_printer_configs_floor ON printer_configs(floor)
          `);

          console.log("Printer configs table columns updated");
        } catch (columnError) {
          console.log(
            "Printer configs columns already exist:",
            columnError.message,
          );
        }
      }
    } catch (error) {
      console.log("Printer configs table initialization error:", error.message);
    }

    // Initialize invoice_items table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS invoice_items (
          id SERIAL PRIMARY KEY,
          invoice_id INTEGER REFERENCES invoices(id) NOT NULL,
          product_id INTEGER,
          product_name VARCHAR(200) NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price DECIMAL(10, 2) NOT NULL,
          total DECIMAL(10, 2) NOT NULL,
          tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 10.00
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON invoice_items(product_id)
      `);

      console.log("Invoice items table initialized");
    } catch (error) {
      console.log(
        "Invoice items table already exists or initialization failed:",
        error,
      );
    }

    // Initialize purchase_receipts table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS purchase_receipts (
          id SERIAL PRIMARY KEY,
          receipt_number TEXT NOT NULL UNIQUE,
          supplier_id INTEGER REFERENCES suppliers(id) NOT NULL,
          employee_id INTEGER REFERENCES employees(id),
          purchase_date DATE,
          actual_delivery_date DATE,
          subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          tax DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_purchase_receipts_receipt_number ON purchase_receipts(receipt_number)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_purchase_receipts_supplier_id ON purchase_receipts(supplier_id)
      `);

      console.log("Purchase receipts table initialized successfully");
    } catch (error) {
      console.log(
        "Purchase receipts table already exists or initialization failed:",
        error,
      );
    }

    // Initialize purchase_receipt_items table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS purchase_receipt_items (
          id SERIAL PRIMARY KEY,
          purchase_receipt_id INTEGER REFERENCES purchase_receipts(id) ON DELETE CASCADE NOT NULL,
          product_id INTEGER REFERENCES products(id),
          product_name TEXT NOT NULL,
          sku TEXT,
          quantity INTEGER NOT NULL,
          received_quantity INTEGER NOT NULL DEFAULT 0,
          unit_price DECIMAL(10, 2) NOT NULL,
          total DECIMAL(10, 2) NOT NULL,
          tax_rate DECIMAL(5, 2) DEFAULT 0.00,
          notes TEXT
        )
      `);

      // Create indexes
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_receipt_id ON purchase_receipt_items(purchase_receipt_id)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_product_id ON purchase_receipt_items(product_id)
      `);

      console.log("Purchase receipt items table initialized successfully");
    } catch (error) {
      console.log(
        "Purchase receipt items table already exists or initialization failed:",
        error,
      );
    }

    // Add row_order column to purchase_receipt_items table
    try {
      await db.execute(sql`
        ALTER TABLE purchase_receipt_items 
        ADD COLUMN IF NOT EXISTS row_order INTEGER DEFAULT 0
      `);

      // Update existing rows with sequential order based on id
      await db.execute(sql`
        UPDATE purchase_receipt_items 
        SET row_order = subquery.row_num
        FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY purchase_receipt_id ORDER BY id) as row_num
          FROM purchase_receipt_items
        ) AS subquery
        WHERE purchase_receipt_items.id = subquery.id
        AND purchase_receipt_items.row_order = 0
      `);

      // Create index for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_row_order 
        ON purchase_receipt_items(purchase_receipt_id, row_order)
      `);

      console.log(
        "Migration for row_order column in purchase_receipt_items completed successfully.",
      );
    } catch (error) {
      console.log(
        "Row_order column migration already applied or error:",
        error,
      );
    }

    // Initialize purchase_receipt_documents table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS purchase_receipt_documents (
          id SERIAL PRIMARY KEY,
          purchase_receipt_id INTEGER REFERENCES purchase_receipts(id) ON DELETE CASCADE NOT NULL,
          file_name TEXT NOT NULL,
          original_file_name TEXT NOT NULL,
          file_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          description TEXT,
          uploaded_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);

      // Create indexes
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_purchase_receipt_documents_receipt_id ON purchase_receipt_documents(purchase_receipt_id)
      `);

      console.log("Purchase receipt documents table initialized successfully");
    } catch (error) {
      console.log(
        "Purchase receipt documents table already exists or initialization failed:",
        error,
      );
    }

    // Add missing created_at and updated_at columns to store_settings
    try {
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      `);

      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      `);

      // Update existing records with timestamps
      await db.execute(sql`
        UPDATE store_settings 
        SET 
          created_at = COALESCE(created_at, to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          updated_at = COALESCE(updated_at, to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      `);

      console.log(
        "✅ Missing timestamp columns added to store_settings successfully",
      );
    } catch (error) {
      console.log(
        "ℹ️ Store settings timestamp columns already exist or migration completed:",
        error.message,
      );
    }

    // Add default_zone column to store_settings
    try {
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS default_zone TEXT DEFAULT 'A'
      `);

      // Update existing records to have default zone value
      await db.execute(sql`
        UPDATE store_settings 
        SET default_zone = COALESCE(default_zone, 'A')
        WHERE default_zone IS NULL
      `);

      console.log(
        "✅ default_zone column added to store_settings successfully",
      );
    } catch (error) {
      console.log(
        "ℹ️ default_zone column already exists or migration completed:",
        error.message,
      );
    }

    // Add userName, password, isAdmin, and parent columns to store_settings
    try {
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS user_name TEXT
      `);
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS password TEXT
      `);
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false
      `);
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS parent TEXT
      `);

      // Remove unique constraint on pin_code to allow duplicates
      await db.execute(sql`
        DROP INDEX IF EXISTS store_settings_pin_code_unique
      `);

      await db.execute(sql`
        DROP INDEX IF EXISTS store_settings_pin_code_unique_idx
      `);

      // Add typeUser column
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS type_user INTEGER DEFAULT 0
      `);

      // Update existing records to have default values
      await db.execute(sql`
        UPDATE store_settings 
        SET is_admin = COALESCE(is_admin, false),
            type_user = COALESCE(type_user, 0)
        WHERE is_admin IS NULL OR type_user IS NULL
      `);

      console.log(
        "✅ userName, password, isAdmin, parent, and typeUser columns added to store_settings successfully",
      );
      console.log("✅ Unique constraint added to pin_code column");
    } catch (error) {
      console.log(
        "ℹ️ User management columns already exist or migration completed:",
        error.message,
      );
    }

    // Ensure floor column exists in tables
    try {
      await db.execute(sql`
        ALTER TABLE tables ADD COLUMN IF NOT EXISTS floor VARCHAR(50) DEFAULT '1층'
      `);

      // Update existing tables
      await db.execute(sql`
        UPDATE tables SET floor = '1층' WHERE floor IS NULL
      `);
      console.log("✅ Floor column added to tables successfully");
    } catch (error) {
      console.log(
        "ℹ️ Floor column already exists or migration completed:",
        error.message,
      );
    }

    // Ensure zone column exists in tables
    try {
      await db.execute(sql`
        ALTER TABLE tables ADD COLUMN IF NOT EXISTS zone VARCHAR(50) DEFAULT 'A구역'
      `);

      // Update existing tables
      await db.execute(sql`
        UPDATE tables SET zone = 'A구역' WHERE zone IS NULL
      `);
      console.log("✅ Zone column added to tables successfully");
    } catch (error) {
      console.log(
        "ℹ️ Zone column already exists or migration completed:",
        error.message,
      );
    }

    // Ensure floor and zone management columns exist in store_settings
    try {
      await db.execute(sql`
        ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS default_floor TEXT DEFAULT '1',
        ADD COLUMN IF NOT EXISTS floor_prefix TEXT DEFAULT '층',
        ADD COLUMN IF NOT EXISTS zone_prefix TEXT DEFAULT '구역'
      `);

      // Remove enable_multi_floor column if it exists
      await db.execute(sql`
        ALTER TABLE store_settings 
        DROP COLUMN IF EXISTS enable_multi_floor
      `);

      // Update existing records
      await db.execute(sql`
        UPDATE store_settings 
        SET 
          default_floor = COALESCE(default_floor, '1'),
          floor_prefix = COALESCE(floor_prefix, '층'),
          zone_prefix = COALESCE(zone_prefix, '구역')
      `);
      console.log("✅ Floor and zone settings columns added successfully");
    } catch (error) {
      console.log(
        "ℹ️ Floor and zone settings columns already exist or migration completed:",
        error.message,
      );
    }

    // Initialize expense_vouchers table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS expense_vouchers (
          id SERIAL PRIMARY KEY,
          voucher_number VARCHAR(50) NOT NULL,
          date VARCHAR(10) NOT NULL,
          amount NUMERIC(12, 2) NOT NULL,
          account VARCHAR(50) NOT NULL,
          recipient VARCHAR(255) NOT NULL,
          phone VARCHAR(20),
          category VARCHAR(50) NOT NULL,
          description TEXT,
          supplier_id INTEGER REFERENCES suppliers(id),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Create indexes for expense_vouchers
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_expense_vouchers_date ON expense_vouchers(date)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_expense_vouchers_voucher_number ON expense_vouchers(voucher_number)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_expense_vouchers_category ON expense_vouchers(category)
      `);

      console.log("Expense vouchers table initialized successfully");
    } catch (error) {
      console.log(
        "Expense vouchers table already exists or initialization failed:",
        error,
      );
    }

    // Migration: Convert all TIMESTAMP columns to TIMESTAMPTZ
    try {
      console.log(
        "🔄 Starting migration: Converting TIMESTAMP to TIMESTAMPTZ...",
      );

      // List of tables and their timestamp columns to migrate
      const timestampMigrations = [
        { table: "employees", columns: ["hire_date", "created_at"] },
        {
          table: "attendance_records",
          columns: [
            "clock_in",
            "clock_out",
            "break_start",
            "break_end",
            "created_at",
          ],
        },
        {
          table: "orders",
          columns: [
            "ordered_at",
            "served_at",
            "paid_at",
            "created_at",
            "updated_at",
          ],
        },
        {
          table: "invoices",
          columns: ["invoice_date", "created_at", "updated_at"],
        },
        {
          table: "einvoice_connections",
          columns: ["created_at", "updated_at"],
        },
        { table: "invoice_templates", columns: ["created_at", "updated_at"] },
        { table: "purchase_receipts", columns: ["created_at", "updated_at"] },
        { table: "purchase_receipt_documents", columns: ["created_at"] },
        { table: "printer_configs", columns: ["created_at", "updated_at"] },
        { table: "tables", columns: ["created_at", "updated_at"] },
        { table: "suppliers", columns: ["created_at", "updated_at"] },
        { table: "customers", columns: ["created_at", "updated_at"] },
        { table: "store_settings", columns: ["created_at", "updated_at"] },
        { table: "expense_vouchers", columns: ["created_at", "updated_at"] },
      ];

      for (const migration of timestampMigrations) {
        for (const column of migration.columns) {
          try {
            // Check if column exists and is TIMESTAMP type
            const columnInfo = await db.execute(sql`
              SELECT data_type 
              FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = ${migration.table} 
              AND column_name = ${column}
            `);

            if (columnInfo.rows.length > 0) {
              const dataType = columnInfo.rows[0].data_type;

              if (dataType === "timestamp without time zone") {
                // Convert TIMESTAMP to TIMESTAMPTZ
                await db.execute(
                  sql.raw(`
                  ALTER TABLE ${migration.table} 
                  ALTER COLUMN ${column} TYPE TIMESTAMPTZ 
                  USING ${column} AT TIME ZONE 'UTC'
                `),
                );

                console.log(
                  `  ✅ Converted ${migration.table}.${column} to TIMESTAMPTZ`,
                );
              } else if (dataType === "timestamp with time zone") {
                console.log(
                  `  ℹ️ ${migration.table}.${column} already TIMESTAMPTZ`,
                );
              }
            }
          } catch (colError) {
            console.log(
              `  ⚠️ Could not convert ${migration.table}.${column}:`,
              colError.message,
            );
          }
        }
      }

      console.log(
        "✅ TIMESTAMP to TIMESTAMPTZ migration completed successfully",
      );
    } catch (migrationError) {
      console.log(
        "⚠️ TIMESTAMP to TIMESTAMPTZ migration error:",
        migrationError,
      );
    }

    // Add receiver_name column to income_vouchers table
    try {
      await db.execute(sql`
        ALTER TABLE income_vouchers 
        ADD COLUMN IF NOT EXISTS receiver_name VARCHAR(255)
      `);

      console.log(
        "Migration for receiver_name column in income_vouchers completed successfully.",
      );
    } catch (error) {
      console.log(
        "Income vouchers receiver_name column migration failed or already applied:",
        error,
      );
    }

    // Initialize payment_methods table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS payment_methods (
          id SERIAL PRIMARY KEY,
          name_key VARCHAR(50) NOT NULL UNIQUE,
          name VARCHAR(100) NOT NULL,
          type VARCHAR(50) NOT NULL,
          icon TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT true,
          sort_order INTEGER DEFAULT 0,
          is_system BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_payment_methods_enabled ON payment_methods(enabled)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_payment_methods_sort_order ON payment_methods(sort_order)
      `);

      // Insert default payment methods if table is empty
      const checkData = await db.execute(sql`
        SELECT COUNT(*) as count FROM payment_methods
      `);

      if (checkData.rows[0]?.count === 0 || checkData.rows[0]?.count === "0") {
        await db.execute(sql`
          INSERT INTO payment_methods (name_key, name, type, icon, enabled, sort_order, is_system) VALUES
          ('cash', 'Tiền mặt', 'cash', '💵', true, 1, true),
          ('creditCard', 'Thẻ tín dụng', 'card', '💳', true, 2, true),
          ('debitCard', 'Thẻ ghi nợ', 'debit', '💳', false, 3, true),
          ('momo', 'MoMo', 'digital', '📱', false, 4, true),
          ('zalopay', 'ZaloPay', 'digital', '📱', true, 5, true),
          ('vnpay', 'VNPay', 'digital', '💳', false, 6, true),
          ('qrCode', 'Mã QR', 'qr', '📱', true, 7, true),
          ('shopeepay', 'ShopeePay', 'digital', '🛒', false, 8, true),
          ('grabpay', 'GrabPay', 'digital', '🚗', false, 9, true)
        `);
        console.log("✅ Default payment methods inserted successfully");
      }

      console.log("Payment methods table initialized successfully");
    } catch (error) {
      console.log(
        "Payment methods table already exists or initialization failed:",
        error,
      );
    }

    // Initialize price_lists table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS price_lists (
          id SERIAL PRIMARY KEY,
          code VARCHAR(50) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          is_active BOOLEAN NOT NULL DEFAULT true,
          is_default BOOLEAN NOT NULL DEFAULT false,
          valid_from TIMESTAMP WITH TIME ZONE,
          valid_to TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_price_lists_code ON price_lists(code)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_price_lists_is_active ON price_lists(is_active)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_price_lists_is_default ON price_lists(is_default)
      `);

      console.log("✅ Price lists table initialized successfully");
    } catch (error) {
      console.log(
        "Price lists table already exists or initialization failed:",
        error,
      );
    }

    // Initialize price_list_items table if it doesn't exist
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS price_list_items (
          id SERIAL PRIMARY KEY,
          price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          price DECIMAL(10, 2) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          UNIQUE(price_list_id, product_id)
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_price_list_items_price_list_id ON price_list_items(price_list_id)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_price_list_items_product_id ON price_list_items(product_id)
      `);

      console.log("✅ Price list items table initialized successfully");
    } catch (error) {
      console.log(
        "Price list items table already exists or initialization failed:",
        error,
      );
    }

    // Comprehensive database schema validation and migration
    console.log("🔍 Starting comprehensive schema validation...");

    // Categories table
    try {
      await db.execute(sql`
        ALTER TABLE categories ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT 'fa-folder'
      `);
      console.log("✅ Categories table schema validated");
    } catch (error) {
      console.log("⚠️ Categories migration error:", error.message);
    }

    // Products table - comprehensive check
    try {
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT
      `);
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id)
      `);
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT
      `);
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
      `);
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN NOT NULL DEFAULT true
      `);
      console.log("✅ Products table schema validated");
    } catch (error) {
      console.log("⚠️ Products migration error:", error.message);
    }

    // Transactions table
    try {
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_id TEXT
      `);
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
      `);
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_received DECIMAL(10,2)
      `);
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS change DECIMAL(10,2)
      `);
      await db.execute(sql`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cashier_name TEXT NOT NULL DEFAULT ''
      `);
      console.log("✅ Transactions table schema validated");
    } catch (error) {
      console.log("⚠️ Transactions migration error:", error.message);
    }

    // Transaction items table
    try {
      await db.execute(sql`
        ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS transaction_id INTEGER REFERENCES transactions(id)
      `);
      await db.execute(sql`
        ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id)
      `);
      await db.execute(sql`
        ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS total DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      console.log("✅ Transaction items table schema validated");
    } catch (error) {
      console.log("⚠️ Transaction items migration error:", error.message);
    }

    // Employees table
    try {
      await db.execute(sql`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_id TEXT
      `);
      await db.execute(sql`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT
      `);
      await db.execute(sql`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT
      `);
      await db.execute(sql`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'cashier'
      `);
      await db.execute(sql`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
      `);
      console.log("✅ Employees table schema validated");
    } catch (error) {
      console.log("⚠️ Employees migration error:", error.message);
    }

    // Attendance records table
    try {
      await db.execute(sql`
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id)
      `);
      await db.execute(sql`
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS total_hours DECIMAL(4,2)
      `);
      await db.execute(sql`
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS overtime DECIMAL(4,2) DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'present'
      `);
      await db.execute(sql`
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS notes TEXT
      `);
      console.log("✅ Attendance records table schema validated");
    } catch (error) {
      console.log("⚠️ Attendance records migration error:", error.message);
    }

    // Store settings table
    try {
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS store_name TEXT NOT NULL DEFAULT 'EDPOS 레스토랑'
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS store_code TEXT
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS tax_id TEXT
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'restaurant'
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS address TEXT
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS phone TEXT
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS email TEXT
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS open_time TEXT DEFAULT '09:00'
      `);
      await db.execute(sql`
        ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS close_time TEXT DEFAULT '22:00'
      `);
      console.log("✅ Store settings table schema validated");
    } catch (error) {
      console.log("⚠️ Store settings migration error:", error.message);
    }

    // Suppliers table
    try {
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS code TEXT
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_person TEXT
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone TEXT
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email TEXT
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_id TEXT
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_account TEXT
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT '30일'
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
      `);
      await db.execute(sql`
        ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT
      `);
      console.log("✅ Suppliers table schema validated");
    } catch (error) {
      console.log("⚠️ Suppliers migration error:", error.message);
    }

    // Customers table
    try {
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_id TEXT
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_code TEXT
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS membership_tier TEXT DEFAULT 'bronze'
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spent DECIMAL(12,2) DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_visit TEXT
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT
      `);
      await db.execute(sql`
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
      `);
      console.log("✅ Customers table schema validated");
    } catch (error) {
      console.log("⚠️ Customers migration error:", error.message);
    }

    // Point transactions table
    try {
      await db.execute(sql`
        ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)
      `);
      await db.execute(sql`
        ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'earned'
      `);
      await db.execute(sql`
        ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id)
      `);
      await db.execute(sql`
        ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id)
      `);
      await db.execute(sql`
        ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS previous_balance INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS new_balance INTEGER NOT NULL DEFAULT 0
      `);
      console.log("✅ Point transactions table schema validated");
    } catch (error) {
      console.log("⚠️ Point transactions migration error:", error.message);
    }

    // Inventory transactions table
    try {
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id)
      `);
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'add'
      `);
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS previous_stock INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS new_stock INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS notes TEXT
      `);
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS invoice_id INTEGER
      `);
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50)
      `);
      await db.execute(sql`
        ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS created_at VARCHAR(50) NOT NULL DEFAULT ''
      `);
      console.log("✅ Inventory transactions table schema validated");
    } catch (error) {
      console.log("⚠️ Inventory transactions migration error:", error.message);
    }

    // E-invoice connections table
    try {
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS symbol VARCHAR(10) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS tax_code VARCHAR(20) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS login_id VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS software_name VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS login_url TEXT
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS sign_method VARCHAR(20) NOT NULL DEFAULT 'Ký server'
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS cqt_code VARCHAR(20) NOT NULL DEFAULT 'Cấp nhật'
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS notes TEXT
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        ALTER TABLE einvoice_connections ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
      `);
      console.log("✅ E-invoice connections table schema validated");
    } catch (error) {
      console.log("⚠️ E-invoice connections migration error:", error.message);
    }

    // Printer configs table
    try {
      await db.execute(sql`
        ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS name VARCHAR(100) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS printer_type VARCHAR(50) NOT NULL DEFAULT 'thermal'
      `);
      await db.execute(sql`
        ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS connection_type VARCHAR(50) NOT NULL DEFAULT 'usb'
      `);
      await db.execute(sql`
        ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)
      `);
      await db.execute(sql`
        ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS port INTEGER DEFAULT 9100
      `);
      await db.execute(sql`
        ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS mac_address VARCHAR(17)
      `);
      await db.execute(sql`
        ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS paper_width INTEGER NOT NULL DEFAULT 80
      `);
      await db.execute(sql`
        ALTER TABLE printer_configs ADD COLUMN IF NOT EXISTS print_speed INTEGER DEFAULT 100
      `);
      console.log("✅ Printer configs table schema validated");
    } catch (error) {
      console.log("⚠️ Printer configs migration error:", error.message);
    }

    // Invoice templates table
    try {
      await db.execute(sql`
        ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS name VARCHAR(100) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS template_number VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS symbol VARCHAR(20) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS use_ck BOOLEAN NOT NULL DEFAULT true
      `);
      await db.execute(sql`
        ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS notes TEXT
      `);
      await db.execute(sql`
        ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
      `);
      console.log("✅ Invoice templates table schema validated");
    } catch (error) {
      console.log("⚠️ Invoice templates migration error:", error.message);
    }

    // Invoices table
    try {
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_name VARCHAR(100) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_tax_code VARCHAR(20)
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_address TEXT
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20)
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_email VARCHAR(100)
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method INTEGER NOT NULL DEFAULT 1
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft'
      `);
      await db.execute(sql`
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT
      `);
      console.log("✅ Invoices table schema validated");
    } catch (error) {
      console.log("⚠️ Invoices migration error:", error.message);
    }

    // Invoice items table
    try {
      await db.execute(sql`
        ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id)
      `);
      await db.execute(sql`
        ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id)
      `);
      await db.execute(sql`
        ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS product_name VARCHAR(200) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      await db.execute(sql`
        ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS total DECIMAL(10,2) NOT NULL DEFAULT 0.00
      `);
      console.log("✅ Invoice items table schema validated");
    } catch (error) {
      console.log("⚠️ Invoice items migration error:", error.message);
    }

    // Income vouchers table
    try {
      await db.execute(sql`
        ALTER TABLE income_vouchers ADD COLUMN IF NOT EXISTS voucher_number VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE income_vouchers ADD COLUMN IF NOT EXISTS date VARCHAR(10) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE income_vouchers ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE income_vouchers ADD COLUMN IF NOT EXISTS account VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE income_vouchers ADD COLUMN IF NOT EXISTS recipient VARCHAR(255) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE income_vouchers ADD COLUMN IF NOT EXISTS phone VARCHAR(20)
      `);
      await db.execute(sql`
        ALTER TABLE income_vouchers ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE income_vouchers ADD COLUMN IF NOT EXISTS description TEXT
      `);
      console.log("✅ Income vouchers table schema validated");
    } catch (error) {
      console.log("⚠️ Income vouchers migration error:", error.message);
    }

    // Expense vouchers table
    try {
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS voucher_number VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS date VARCHAR(10) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS account VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS recipient VARCHAR(255) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS phone VARCHAR(20)
      `);
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT ''
      `);
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS description TEXT
      `);
      await db.execute(sql`
        ALTER TABLE expense_vouchers ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id)
      `);
      console.log("✅ Expense vouchers table schema validated");
    } catch (error) {
      console.log("⚠️ Expense vouchers migration error:", error.message);
    }

    console.log("✅ Comprehensive schema validation completed successfully");

    // Add payment information columns to purchase_receipts
    try {
      await db.execute(sql`
        ALTER TABLE purchase_receipts 
        ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        ALTER TABLE purchase_receipts 
        ADD COLUMN IF NOT EXISTS payment_method TEXT
      `);
      await db.execute(sql`
        ALTER TABLE purchase_receipts 
        ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(18,2)
      `);

      // Create index for is_paid
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_purchase_receipts_is_paid 
        ON purchase_receipts(is_paid)
      `);

      console.log(
        "Migration for payment info columns in purchase_receipts completed successfully.",
      );
    } catch (error) {
      console.log(
        "Payment info columns migration already applied or error:",
        error,
      );
    }

    // Add domain column to store_settings table
    try {
      await db.execute(sql`

      ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS domain TEXT
      `);

      console.log(
        "Migration for domain column in store_settings completed successfully.",
      );
    } catch (error) {
      console.log("Domain column migration already applied or error:", error);
    }

    // Add price_list_id column to store_settings
    try {
      await db.execute(sql`

      ALTER TABLE store_settings 
        ADD COLUMN IF NOT EXISTS price_list_id INTEGER REFERENCES price_lists(id)
      `);

      // Create index for price_list_id
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_store_settings_price_list_id 
        ON store_settings(price_list_id)
      `);

      console.log(
        "Migration for price_list_id column in store_settings completed successfully.",
      );
    } catch (error) {
      console.log("Price list ID migration already applied or error:", error);
    }

    // Add store_code to price_lists and price_list_items tables
    try {
      await db.execute(sql`
        ALTER TABLE price_lists 
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50)
      `);

      await db.execute(sql`
        ALTER TABLE price_list_items 
        ADD COLUMN IF NOT EXISTS store_code VARCHAR(50)
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_price_lists_store_code ON price_lists(store_code)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_price_list_items_store_code ON price_list_items(store_code)
      `);

      console.log(
        "Migration for store_code columns in price_lists tables completed successfully.",
      );
    } catch (error) {
      console.log(
        "Price lists store_code migration already applied or error:",
        error,
      );
    }

    // Create general_settings table
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS general_settings (
          id SERIAL PRIMARY KEY,
          setting_code VARCHAR(100) NOT NULL UNIQUE,
          setting_name VARCHAR(255) NOT NULL,
          setting_value TEXT,
          description TEXT,
          is_active BOOLEAN NOT NULL DEFAULT true,
          store_code VARCHAR(50),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
      `);

      // Create indexes for better performance
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_general_settings_code ON general_settings(setting_code)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_general_settings_active ON general_settings(is_active)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_general_settings_store_code ON general_settings(store_code)
      `);

      console.log("✅ General settings table initialized successfully");
    } catch (error) {
      console.log(
        "General settings table already exists or initialization failed:",
        error,
      );
    }

    // Add price_list_id column to store_settings
    try {
      await db.execute(sql`

     ALTER TABLE store_settings 
        ADD
  COLUMN IF NOT EXISTS price_list_id
  INTEGER REFERENCES price_lists(id)
      `);

      // Create index for price_list_id
      await db.execute(sql`

  CREATE INDEX IF
  NOT EXISTS idx_store_settings_price_list_id 

    ON store_settings(price_list_id)
      `);

      console.log(
        "Migration for price_list_id column in store_settings completed successfully.",
      );
    } catch (error) {
      console.log("Price list ID migration already applied or error:", error);
    }

    // Run comprehensive column check migration
    try {
      console.log("🔍 Checking for missing columns from schema.ts...");

      // Read and execute the comprehensive migration file
      const fs = await import("fs");
      const path = await import("path");
      const migrationPath = path.join(
        process.cwd(),
        "server",
        "check_and_add_missing_columns.sql",
      );

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, "utf-8");
        await db.execute(sql.raw(migrationSQL));
        console.log("✅ Column check migration completed successfully");
      } else {
        console.log("⚠️ Migration file not found, skipping column check");
      }
    } catch (migrationError) {
      console.log("⚠️ Column check migration error:", migrationError);
    }

    console.log("✅ Database setup completed successfully");
  } catch (error) {
    console.log("⚠️ Sample data initialization skipped:", error);
  }
}
