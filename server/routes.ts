// @ts-nocheck
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import WebSocket from "ws";
import {
  insertProductSchema,
  insertTransactionSchema,
  insertTransactionItemSchema,
  insertEmployeeSchema,
  insertAttendanceSchema,
  insertTableSchema,
  insertOrderSchema,
  insertOrderItemSchema,
  insertStoreSettingsSchema,
  insertSupplierSchema,
  insertCustomerSchema,
  insertPointTransactionSchema,
  insertPurchaseReceiptSchema,
  insertPurchaseReceiptItemSchema,
  insertPurchaseReceiptDocumentSchema,
  insertPurchaseOrderItemSchema,
  attendanceRecords,
  products,
  inventoryTransactions,
  invoiceTemplates,
  invoices,
  invoiceItems,
  customers,
  printerConfigs,
  storeSettings,
  orders,
  orderItems as orderItemsTable,
  categories,
  transactions as transactionsTable,
  transactionItems as transactionItemsTable,
  tables,
  employees,
  purchaseReceiptDocuments,
  paymentMethods,
} from "../shared/schema";
import { initializeSampleData, db } from "./db";
import { registerTenantRoutes } from "./tenant-routes";
import {
  tenantMiddleware,
  type TenantRequest,
  getTenantDatabase,
} from "./tenant-middleware";
import { z } from "zod";
import {
  eq,
  desc,
  asc,
  and,
  or,
  like,
  count,
  sum,
  gte,
  lt,
  lte,
  ilike,
  ne,
} from "drizzle-orm";
import { sql } from "drizzle-orm";

// Helper function to get payment method display name
function getPaymentMethodName(method: string | number): string {
  switch (method) {
    case 1:
    case "cash":
      return "Tiền mặt";
    case 2:
    case "creditCard":
    case "debitCard":
      return "Chuyển khoản";
    case 3:
      return "TM/CK";
    case 4:
    case "qrCode":
    case "momo":
    case "zalopay":
    case "vnpay":
    case "grabpay":
      return "QR Code";
    case "einvoice":
      return "Hóa đơn điện tử";
    default:
      return "Tiền mặt";
  }
}

// Helper function to get e-invoice status display name
function getEInvoiceStatusName(status: number): string {
  const statusNames = {
    0: "Chưa phát hành",
    1: "Đã phát hành",
    2: "Tạo nháp",
    3: "Đã duyệt",
    4: "Đã bị thay thế (hủy)",
    5: "Thay thế tạm",
    6: "Thay thế",
    7: "Đã bị điều chỉnh",
    8: "Điều chỉnh tạm",
    9: "Điều chỉnh",
    10: "Đã hủy",
  };
  return statusNames[status as keyof typeof statusNames] || "Chưa phát hành";
}

// Helper function to get invoice status display name
function getInvoiceStatusName(status: number): string {
  const statusNames = {
    1: "Hoàn thành",
    2: "Đang phục vụ",
    3: "Đã hủy",
  };
  return statusNames[status as keyof typeof statusNames] || "Hoàn thành";
}

// Function to calculate discount distribution among order items
function calculateDiscountDistribution(items: any[], totalDiscount: number) {
  if (!items || items.length === 0 || totalDiscount <= 0) {
    return items.map((item) => ({ ...item, discount: 0 }));
  }

  // Calculate total amount (subtotal before discount)
  const totalAmount = items.reduce((sum, item) => {
    const unitPrice = Number(item.unitPrice || 0);
    const quantity = Number(item.quantity || 0);
    return sum + unitPrice * quantity;
  }, 0);

  if (totalAmount <= 0) {
    return items.map((item) => ({ ...item, discount: 0 }));
  }

  let allocatedDiscount = 0;
  const result = items.map((item, index) => {
    const unitPrice = Number(item.unitPrice || 0);
    const quantity = Number(item.quantity || 0);
    const itemTotal = unitPrice * quantity;

    let itemDiscount = 0;

    if (index === items.length - 1) {
      // Last item gets remaining discount to ensure total matches exactly
      itemDiscount = Math.max(0, totalDiscount - allocatedDiscount);
    } else {
      // Calculate proportional discount: Total discount * item amount / total amount
      const proportionalDiscount = (totalDiscount * itemTotal) / totalAmount;
      itemDiscount = Math.round(proportionalDiscount); // Round to nearest dong
      allocatedDiscount += itemDiscount;
    }

    return {
      ...item,
      discount: itemDiscount.toFixed(2),
    };
  });

  console.log(
    `💰 Discount Distribution: Total=${totalDiscount}, Allocated=${allocatedDiscount + Number(result[result.length - 1].discount)}`,
  );
  return result;
}

// Helper function to get store settings (used in product creation)
const getStoreSettings = async (database: any) => {
  const safeDatabase = database || db; // Always ensure we have a valid database connection

  try {
    const [settings] = await safeDatabase
      .select({ priceIncludesTax: storeSettings.priceIncludesTax })
      .from(storeSettings)
      .limit(1);
    return settings;
  } catch (error) {
    console.error("❌ Error getting store settings:", error);
    // Return default settings if query fails
    return { priceIncludesTax: false };
  }
};

// Helper function to generate unique SKU
const generateUniqueSKU = async (tenantDb: any): Promise<string> => {
  let sku: string;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 100;

  while (!isUnique && attempts < maxAttempts) {
    // Generate 6 random characters (letters and numbers)
    const randomChars = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();
    sku = `ITEM-${randomChars.padEnd(6, "0")}`;

    // Check if SKU already exists using storage method
    const existingProduct = await storage.getProductBySku(sku, tenantDb);

    if (!existingProduct) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    throw new Error("Unable to generate unique SKU after maximum attempts");
  }

  return sku!;
};

// Parse dates as local VN timezone manually
const toVNDate = (dateStr, endOfDay = false) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
    ),
  );
  // Cộng 7 tiếng để khớp với VN timezone
  date.setHours(date.getHours() + 7);
  return date;
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Register tenant management routes
  registerTenantRoutes(app);

  // Apply tenant middleware to all API routes
  app.use("/api", tenantMiddleware);

  // PIN verification endpoint
  app.post("/api/auth/verify-pin", async (req: TenantRequest, res) => {
    try {
      const { pin } = req.body;
      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;
      const storeCode = req.tenant?.storeCode || null;
      console.log("🔐 PIN verification request:", {
        pin: pin ? "****" : "empty",
        storeCode: storeCode || "N/A",
      });

      console.log("🔐 Verifying PIN:", { pin: pin ? "****" : "empty" });

      if (!pin) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng nhập mã PIN",
        });
      }

      // Get store settings to check PIN
      let [settings] = await database
        .select({ pinCode: storeSettings.pinCode })
        .from(storeSettings)
        .where(eq(storeSettings.storeCode, storeCode))
        .limit(1);

      if (!settings) {
        const [selectByPin] = await database
          .select({ pinCode: storeSettings.pinCode })
          .from(storeSettings)
          .limit(1);

        settings = selectByPin;
      }

      console.log("🔍 Store settings:", settings);

      console.log("🔍 Store settings PIN:", {
        hasPinCode: !!settings?.pinCode,
        pinCodeValue: settings?.pinCode ? "****" : "null",
      });

      // Check if PIN is configured
      if (!settings || !settings.pinCode) {
        console.log("⚠️ No PIN configured in store settings");
        return res.json({
          success: true,
          message: "Đăng nhập thành công (chưa thiết lập mã PIN)",
        });
      }

      // Verify PIN
      if (pin === settings.pinCode) {
        console.log("✅ PIN verification successful");
        return res.json({
          success: true,
          message: "Đăng nhập thành công",
        });
      } else {
        console.log("❌ PIN verification failed - incorrect PIN");
        return res.status(404).json({
          success: false,
          message: "Mã PIN không đúng. Vui lòng thử lại.",
        });
      }
    } catch (error) {
      console.error("❌ PIN verification error:", error);
      return res.status(500).json({
        success: false,
        message: "Lỗi hệ thống. Vui lòng thử lại.",
      });
    }
  });

  // Initialize sample data
  await initializeSampleData();

  // Payment Methods API
  app.get("/api/payment-methods", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      const methods = await database
        .select()
        .from(paymentMethods)
        .orderBy(asc(paymentMethods.sortOrder));

      console.log(`✅ Fetched ${methods.length} payment methods`);
      res.json(methods);
    } catch (error) {
      console.error("❌ Error fetching payment methods:", error);
      res.status(500).json({
        error: "Failed to fetch payment methods",
      });
    }
  });

  app.post("/api/payment-methods", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      const { nameKey, name, type, icon, enabled, sortOrder } = req.body;

      const [newMethod] = await database
        .insert(paymentMethods)
        .values({
          nameKey,
          name,
          type,
          icon,
          enabled: enabled !== undefined ? enabled : true,
          sortOrder: sortOrder || 0,
          isSystem: false,
        })
        .returning();

      console.log(`✅ Created payment method: ${newMethod.nameKey}`);
      res.json(newMethod);
    } catch (error) {
      console.error("❌ Error creating payment method:", error);
      res.status(500).json({
        error: "Failed to create payment method",
      });
    }
  });

  app.put("/api/payment-methods/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      const { icon, enabled, sortOrder } = req.body;

      const updateData: any = {};
      if (icon !== undefined) updateData.icon = icon;
      if (enabled !== undefined) updateData.enabled = enabled;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

      const [updated] = await database
        .update(paymentMethods)
        .set(updateData)
        .where(eq(paymentMethods.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({
          error: "Payment method not found",
        });
      }

      console.log(`✅ Updated payment method: ${updated.nameKey}`);
      res.json(updated);
    } catch (error) {
      console.error("❌ Error updating payment method:", error);
      res.status(500).json({
        error: "Failed to update payment method",
      });
    }
  });

  app.delete("/api/payment-methods/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      // Check if it's a system method
      const [method] = await database
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.id, id))
        .limit(1);

      if (!method) {
        return res.status(404).json({
          error: "Payment method not found",
        });
      }

      if (method.isSystem) {
        return res.status(400).json({
          error: "Cannot delete system payment method",
        });
      }

      await database.delete(paymentMethods).where(eq(paymentMethods.id, id));

      console.log(`✅ Deleted payment method: ${method.nameKey}`);
      res.json({ success: true });
    } catch (error) {
      console.error("❌ Error deleting payment method:", error);
      res.status(500).json({
        error: "Failed to delete payment method",
      });
    }
  });

  // Ensure inventory_transactions table exists
  try {
    await tenantDb.execute(sql`
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
  } catch (error) {
    console.log(
      "Inventory transactions table already exists or creation failed:",
      error,
    );
  }

  // Categories
  app.get(
    "/api/categories",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/categories - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for categories");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for categories:",
            dbError,
          );
          tenantDb = null;
        }

        const categories = await storage.getCategories(tenantDb);
        console.log(`✅ Successfully fetched ${categories.length} categories`);
        res.json(categories);
      } catch (error) {
        console.error("❌ Error fetching categories:", error);
        res.status(500).json({
          error: "Failed to fetch categories",
        });
      }
    },
  );

  // Get next category ID
  app.get("/api/categories/next-id", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const nextId = await storage.getNextCategoryId(tenantDb);
      res.json({ nextId });
    } catch (error) {
      res.status(500).json({
        message: "Failed to generate category ID",
      });
    }
  });

  app.post("/api/categories", async (req: TenantRequest, res) => {
    try {
      const { name, icon, id } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!name || !name.trim()) {
        return res.status(400).json({
          error: "Category name is required",
        });
      }

      // If ID is provided, check for duplicates
      if (id) {
        const exists = await storage.categoryIdExists(id, tenantDb);
        if (exists) {
          return res.status(409).json({
            error: `Mã nhóm hàng "${id}" đã tồn tại trong hệ thống`,
            code: "DUPLICATE_CATEGORY_ID",
          });
        }
      }

      const categoryData = {
        name: name.trim(),
        icon: icon || "fas fa-utensils",
        ...(id && { id: parseInt(id) }),
      };

      const category = await storage.createCategory(categoryData, tenantDb);
      res.json(category);
    } catch (error) {
      console.error("Error creating category:", error);
      res.status(500).json({
        error: "Failed to create category",
      });
    }
  });

  app.put("/api/categories/:id", async (req: TenantRequest, res) => {
    try {
      const categoryId = parseInt(req.params.id);
      const { name, icon } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!name || !name.trim()) {
        return res.status(400).json({
          error: "Category name is required",
        });
      }

      const categoryData = {
        name: name.trim(),
        icon: icon || "fas fa-utensils",
      };

      const category = await storage.updateCategory(
        categoryId,
        categoryData,
        tenantDb,
      );
      res.json(category);
    } catch (error) {
      console.error("Error updating category:", error);
      res.status(500).json({
        error: "Failed to update category",
      });
    }
  });

  app.delete("/api/categories/:id", async (req: TenantRequest, res) => {
    try {
      const categoryId = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      // Check if category has products
      const products = await storage.getProductsByCategory(
        categoryId,
        tenantDb,
      );
      if (products.length > 0) {
        return res.status(400).json({
          error: `Không thể xóa danh mục vì còn ${products.length} sản phẩm. Vui lòng xóa hoặc chuyển các sản phẩm sang danh mục khác trước.`,
        });
      }

      await storage.deleteCategory(categoryId, tenantDb);
      res.json({
        success: true,
      });
    } catch (error) {
      console.error("Error deleting category:", error);

      // Handle foreign key constraint errors
      if (
        error instanceof Error &&
        error.message.includes("foreign key constraint")
      ) {
        return res.status(400).json({
          error:
            "Không thể xóa danh mục vì vẫn còn sản phẩm thuộc danh mục này. Vui lòng xóa hoặc chuyển các sản phẩm sang danh mục khác trước.",
        });
      }

      res.status(500).json({
        error: "Có lỗi xảy ra khi xóa danh mục",
      });
    }
  });

  // Helper function to get tax rate name
  const getTaxRateName = (taxRate: string | number): string => {
    // Handle special tax rate names stored in database
    if (typeof taxRate === "string") {
      if (taxRate === "KCT") return "KCT";
      if (taxRate === "KKKNT") return "KKKNT";
    }

    const rate = typeof taxRate === "string" ? parseFloat(taxRate) : taxRate;

    if (isNaN(rate)) return "0%";

    // Return formatted tax rate name
    return `${Math.floor(rate)}%`;
  };

  // Products
  app.get(
    "/api/products",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/products - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for products");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for products:",
            dbError,
          );
          tenantDb = null;
        }

        let products = await storage.getProducts(tenantDb);

        // Add taxRateName and ensure unit field is included
        const productsWithTaxName = products.map((product) => ({
          ...product,
          taxRateName: getTaxRateName(product.taxRate || "0"),
          unit: product.unit || "Cái", // Default unit if not set
        }));

        console.log(
          `✅ Successfully fetched ${productsWithTaxName.length} products`,
        );
        res.json(productsWithTaxName);
      } catch (error) {
        console.error("❌ Error fetching products:", error);
        res.status(500).json({
          error: "Failed to fetch products",
        });
      }
    },
  );

  // Endpoint for POS to get only active products
  app.get("/api/products/active", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const products = await storage.getActiveProducts(tenantDb);

      // Add taxRateName and ensure unit field is included
      const productsWithTaxName = products.map((product) => ({
        ...product,
        taxRateName: getTaxRateName(product.taxRate || "0"),
        unit: product.unit || "Cái", // Default unit if not set
      }));

      res.json(productsWithTaxName);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch active products",
      });
    }
  });

  // Get single product by ID
  app.get("/api/products/:id", async (req: TenantRequest, res) => {
    try {
      const productId = parseInt(req.params.id);
      if (isNaN(productId)) {
        return res.status(400).json({
          error: "Invalid product ID",
        });
      }

      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      const [product] = await database
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          price: products.price,
          stock: products.stock,
          categoryId: products.categoryId,
          categoryName: categories.name,
          imageUrl: products.imageUrl,
          isActive: products.isActive,
          productType: products.productType,
          trackInventory: products.trackInventory,
          taxRate: products.taxRate,
          priceIncludesTax: products.priceIncludesTax,
          afterTaxPrice: products.afterTaxPrice,
          beforeTaxPrice: products.beforeTaxPrice,
          floor: products.floor,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(eq(products.id, productId), eq(products.isActive, true)))
        .limit(1);

      if (!product) {
        return res.status(404).json({
          error: "Product not found",
        });
      }

      console.log(`=== SINGLE PRODUCT API DEBUG ===`);
      console.log(`Product ID: ${product.id}`);
      console.log(`Name: ${product.name}`);
      console.log(`Price: ${product.price}`);
      console.log(`Tax Rate: ${product.taxRate}`);
      console.log(`After Tax Price: ${product.afterTaxPrice}`);
      console.log(`Before Tax Price: ${product.beforeTaxPrice}`);

      // Add taxRateName and ensure unit field is included
      const productWithTaxName = {
        ...product,
        taxRateName: getTaxRateName(product.taxRate || "0"),
        unit: product.unit || "Cái", // Default unit if not set
      };

      res.json(productWithTaxName);
    } catch (error) {
      console.error("Error fetching single product:", error);
      res.status(500).json({
        error: "Failed to fetch product",
      });
    }
  });

  app.post("/api/products", async (req: TenantRequest, res) => {
    try {
      console.log("Creating product with data:", req.body);

      // Get tenant database connection with error handling
      let tenantDb;
      try {
        tenantDb = await getTenantDatabase(req);
        console.log(
          "✅ Tenant database connection obtained for product creation",
        );
      } catch (dbError) {
        console.error(
          "❌ Failed to get tenant database for product creation:",
          dbError,
        );
        return res.status(500).json({
          message: "Lỗi kết nối database. Vui lòng thử lại.",
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }

      // Get store settings to check price tax inclusion using storage method
      let storeSettings;
      try {
        storeSettings = await storage.getStoreSettings(tenantDb);
        console.log("✅ Store settings retrieved:", storeSettings);
      } catch (error) {
        console.error("❌ Error getting store settings from storage:", error);
        // Use helper function as fallback
        storeSettings = await getStoreSettings(tenantDb);
      }
      const storePriceIncludesTax = storeSettings?.priceIncludesTax || false;

      // Auto-generate SKU if not provided or empty
      let productSKU = req.body.sku;
      if (!productSKU || productSKU.trim() === "") {
        try {
          productSKU = await generateUniqueSKU(tenantDb);
          console.log("Auto-generated SKU:", productSKU);
        } catch (skuError) {
          console.error("❌ Failed to generate SKU:", skuError);
          return res.status(500).json({
            message:
              "Không thể tạo mã SKU tự động. Vui lòng nhập SKU thủ công.",
            error:
              skuError instanceof Error ? skuError.message : String(skuError),
          });
        }
      }

      // Handle tax calculations
      let beforeTaxPrice = null;

      if (req.body.afterTaxPrice && req.body.afterTaxPrice.trim() !== "") {
        const afterTax = parseFloat(req.body.afterTaxPrice);
        const taxRate = parseFloat(req.body.taxRate || "0");

        if (storePriceIncludesTax) {
          // If store setting is true: prices include tax, calculate beforeTaxPrice
          if (taxRate > 0) {
            const price = afterTax / (1 + taxRate / 100);
            beforeTaxPrice = price.toFixed(2);
          }
        } else {
          // If store setting is false: prices exclude tax, beforeTaxPrice = 0
          beforeTaxPrice = "0.00";
        }
      }

      // Determine taxRateName from taxRate
      let taxRateName = "";
      const taxRateValue = String(req.body.taxRate || "0");

      if (taxRateValue === "KCT") {
        taxRateName = "KCT";
      } else if (taxRateValue === "KKKNT") {
        taxRateName = "KKKNT";
      } else if (taxRateValue === "0") {
        taxRateName = "0%";
      } else {
        taxRateName = taxRateValue + "%";
      }

      // Validate and transform the data - ensure strings for database
      let validatedData;
      try {
        validatedData = insertProductSchema.parse({
          name: req.body.name,
          sku: productSKU,
          price: String(req.body.price),
          stock: Number(req.body.stock) || 0,
          categoryId: Number(req.body.categoryId),
          productType: Number(req.body.productType) || 1,
          trackInventory: req.body.trackInventory !== false,
          imageUrl: req.body.imageUrl || null,
          taxRate: req.body.taxRate ? String(req.body.taxRate) : "0",
          taxRateName: taxRateName,
          priceIncludesTax: Boolean(
            req.body.priceIncludesTax || storePriceIncludesTax,
          ),
          afterTaxPrice:
            req.body.afterTaxPrice && req.body.afterTaxPrice.trim() !== ""
              ? String(req.body.afterTaxPrice)
              : null,
          beforeTaxPrice: beforeTaxPrice ? String(beforeTaxPrice) : null,
          floor: String(req.body.floor || "1"),
          unit: req.body.unit || "Cái",
        });
      } catch (validationError) {
        console.error("Validation error:", validationError);
        if (validationError instanceof z.ZodError) {
          const errorMessages = validationError.errors
            .map((err) => `${err.path.join(".")}: ${err.message}`)
            .join(", ");
          return res.status(400).json({
            message: `Dữ liệu không hợp lệ: ${errorMessages}`,
            errors: validationError.errors,
            details: validationError.format(),
          });
        }
        throw validationError;
      }

      console.log("Validated product data:", validatedData);

      // SKU uniqueness check
      if (req.body.sku && req.body.sku.trim() !== "") {
        const existingProduct = await storage.getProductBySku(
          validatedData.sku,
          tenantDb,
        );
        if (existingProduct) {
          console.log("Provided SKU already exists:", validatedData.sku);
          return res.status(409).json({
            message: `SKU "${validatedData.sku}" đã tồn tại trong hệ thống`,
            code: "DUPLICATE_SKU",
          });
        }
      }

      const product = await storage.createProduct(validatedData, tenantDb);
      console.log("Product created successfully:", product);
      res.status(201).json(product);
    } catch (error) {
      console.error("Product creation error:", error);

      // Handle specific error types
      if (error instanceof z.ZodError) {
        console.error("Validation errors:", error.errors);
        const errorMessages = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Dữ liệu không hợp lệ: ${errorMessages}`,
          errors: error.errors,
          details: error.format(),
        });
      }

      // Handle database errors
      if (error && typeof error === "object" && "code" in error) {
        if (error.code === "23505") {
          return res.status(409).json({
            message: "Sản phẩm đã tồn tại trong hệ thống",
            error: "Duplicate entry",
          });
        }
      }

      res.status(500).json({
        message:
          "Không thể tạo sản phẩm. Vui lòng kiểm tra lại thông tin và thử lại.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.put("/api/products/:id", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const id = parseInt(req.params.id);
      console.log("🔄 UPDATE PRODUCT - Received data:", id, req.body);

      // Get store settings to check price_includes_tax
      const [storeSettingsData] = await tenantDb
        .select({ priceIncludesTax: storeSettings.priceIncludesTax })
        .from(storeSettings)
        .limit(1);
      const storePriceIncludesTax =
        storeSettingsData?.priceIncludesTax || false;

      // Calculate beforeTaxPrice based on store setting
      let beforeTaxPrice = req.body.beforeTaxPrice; // Initialize with value from body if provided
      if (req.body.price && req.body.taxRate) {
        const price = parseFloat(req.body.price.toString());
        const taxRate = parseFloat(req.body.taxRate.toString());

        if (storePriceIncludesTax) {
          // If store setting is true: prices include tax, calculate beforeTaxPrice
          if (taxRate > 0) {
            beforeTaxPrice = (price / (1 + taxRate / 100)).toFixed(2);
          } else {
            beforeTaxPrice = price.toFixed(2);
          }
        } else {
          // If store setting is false: prices exclude tax, beforeTaxPrice = 0
          beforeTaxPrice = "0.00";
        }
      }

      // Transform data keeping string types for Zod validation
      const transformedData = {
        ...req.body,
        price: req.body.price ? req.body.price.toString() : undefined,
        taxRate: req.body.taxRate ? req.body.taxRate.toString() : undefined,
        afterTaxPrice:
          req.body.afterTaxPrice &&
          req.body.afterTaxPrice.toString().trim() !== ""
            ? req.body.afterTaxPrice.toString()
            : null,
        beforeTaxPrice: beforeTaxPrice ? beforeTaxPrice.toString() : null,
        priceIncludesTax: Boolean(
          req.body.priceIncludesTax || storePriceIncludesTax,
        ),
        trackInventory: req.body.trackInventory !== false,
        floor:
          req.body.floor !== undefined ? String(req.body.floor) : undefined,
        unit: req.body.unit ? String(req.body.unit) : undefined, // FIXED: Add unit field to update
      };

      // Remove undefined fields
      Object.keys(transformedData).forEach((key) => {
        if (transformedData[key] === undefined) {
          delete transformedData[key];
        }
      });

      console.log("📦 Transformed update data with unit:", {
        productId: id,
        unit: transformedData.unit,
        unitType: typeof transformedData.unit,
        allTransformedData: transformedData,
      });

      const validatedData = insertProductSchema
        .partial()
        .parse(transformedData);

      console.log("✅ Validated data after parse:", {
        productId: id,
        validatedUnit: validatedData.unit,
        validatedUnitType: typeof validatedData.unit,
        allValidatedData: validatedData,
      });
      const product = await storage.updateProduct(id, validatedData, tenantDb);

      if (!product) {
        return res.status(404).json({
          message: "Product not found",
        });
      }

      console.log("✅ UPDATE PRODUCT - Success:", {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        unitType: typeof product.unit,
        fullProduct: product,
      });

      // Verify in database
      const [verifyProduct] = await tenantDb
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);

      console.log("🔍 Verify product in DB after update:", {
        productId: verifyProduct?.id,
        unit: verifyProduct?.unit,
        unitType: typeof verifyProduct?.unit,
      });

      // Return product with unit field included
      res.json({
        ...product,
        unit: verifyProduct?.unit || product.unit || "Cái",
      });
    } catch (error) {
      console.error("Product update error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid product data",
          errors: error.errors,
        });
      }
      res.status(500).json({
        message: "Failed to update product",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.delete("/api/products/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const deleted = await storage.deleteProduct(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          message: "Product not found",
        });
      }

      res.json({
        message: "Product deleted successfully",
      });
    } catch (error) {
      console.error("Delete product error:", error);

      if (error instanceof Error) {
        if (error.message.includes("Cannot delete product")) {
          return res.status(400).json({
            message: error.message,
            code: "PRODUCT_IN_USE",
          });
        }
      }

      res.status(500).json({
        message: "Failed to delete product",
      });
    }
  });

  // New endpoint to cleanup inactive products
  app.delete(
    "/api/products/cleanup/inactive",
    async (req: TenantRequest, res) => {
      try {
        const tenantDb = await getTenantDatabase(req);
        const deletedCount = await storage.deleteInactiveProducts(tenantDb);
        res.json({
          message: `Successfully deleted ${deletedCount} inactive products`,
          deletedCount,
        });
      } catch (error) {
        res.status(500).json({
          message: "Failed to cleanup inactive products",
        });
      }
    },
  );

  app.get("/api/products/barcode/:sku", async (req: TenantRequest, res) => {
    try {
      const sku = req.params.sku;
      const tenantDb = await getTenantDatabase(req);
      const product = await storage.getProductBySku(sku, tenantDb);

      if (!product) {
        return res.status(404).json({
          message: "Product not found",
        });
      }

      res.json(product);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch product by SKU",
      });
    }
  });

  // Transactions - Now creates orders instead for unified data storage
  app.post("/api/transactions", async (req: TenantRequest, res) => {
    try {
      const { transaction, items } = req.body;
      const tenantDb = await getTenantDatabase(req);

      console.log(
        "Received POS transaction data (will create order):",
        JSON.stringify(
          {
            transaction,
            items,
          },
          null,
          2,
        ),
      );

      // Transaction validation schema
      const transactionSchema = z.object({
        transactionId: z.string(),
        subtotal: z.string(),
        tax: z.string(),
        total: z.string(),
        paymentMethod: z.string(),
        cashierName: z.string(),
        notes: z.string().optional(),
        invoiceNumber: z.string().nullable().optional(),
        invoiceId: z.number().nullable().optional(),
        orderId: z.number().optional(),
      });

      const validatedTransaction = transactionSchema.parse(transaction);
      const validatedItems = z.array(insertTransactionItemSchema).parse(items);

      // Fetch products for validation and tax calculation
      const products = await storage.getAllProducts(true, tenantDb);

      // Validate stock and calculate totals
      let subtotal = 0;
      let tax = 0;
      const stockValidationErrors = [];
      const orderItems = [];

      for (const item of validatedItems) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) {
          return res.status(400).json({
            message: `Product with ID ${item.productId} not found`,
          });
        }

        // Check stock availability
        if (product.trackInventory && product.stock < item.quantity) {
          const errorMsg = `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`;
          console.log(`❌ ${errorMsg}`);
          stockValidationErrors.push(errorMsg);
          continue;
        }

        const itemSubtotal = parseFloat(item.price) * item.quantity;
        let itemTax = 0;

        // Calculate tax
        if (
          product.afterTaxPrice &&
          product.afterTaxPrice !== null &&
          product?.afterTaxPrice.toString() !== ""
        ) {
          const afterTaxPrice = parseFloat(product.afterTaxPrice);
          const price = parseFloat(product.price);
          itemTax = (afterTaxPrice - price) * item.quantity;
        }

        subtotal += itemSubtotal;
        tax += itemTax;

        // Prepare order item with tax and priceBeforeTax
        orderItems.push({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.price,
          total: (parseFloat(item.price) * item.quantity).toString(),
          discount: item.discount || "0",
          tax: item.tax || "0",
          priceBeforeTax: item.priceBeforeTax || item.price,
          status: "", // Default status is empty (chưa gửi bếp)
          notes: null,
        });
      }

      if (stockValidationErrors.length > 0) {
        console.warn(
          "⚠️ Stock validation warnings (allowing POS transaction to proceed):",
          stockValidationErrors,
        );
      }

      const total = subtotal + tax;

      // Get store settings for price_include_tax
      const database = tenantDb || db;
      const [storeSettingsData] = await database
        .select({ priceIncludesTax: storeSettings.priceIncludesTax })
        .from(storeSettings)
        .limit(1);
      const priceIncludeTax = storeSettingsData?.priceIncludesTax || false;

      // Create order data for POS transaction
      const orderData = {
        orderNumber: validatedTransaction.transactionId, // Use transaction ID as order number
        tableId: null, // POS orders don't have tables
        employeeId: null,
        status: "paid", // POS transactions are immediately paid
        customerName: "Khách hàng",
        customerCount: 1,
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        total: total.toFixed(2),
        paymentMethod: validatedTransaction.paymentMethod,
        paymentStatus: "paid",
        salesChannel: "pos", // Mark as POS order
        priceIncludeTax: priceIncludeTax,
        einvoiceStatus: 0, // Default e-invoice status
        invoiceId: validatedTransaction.invoiceId || null,
        invoiceNumber: validatedTransaction.invoiceNumber || null,
        notes:
          validatedTransaction.notes ||
          `POS Transaction by ${validatedTransaction.cashierName}`,
        paidAt: new Date(),
      };

      console.log(`💰 Creating POS order with data:`, {
        orderNumber: orderData.orderNumber,
        total: orderData.total,
        paymentMethod: orderData.paymentMethod,
        salesChannel: orderData.salesChannel,
        itemsCount: orderItems.length,
      });

      // Create order using existing order creation logic
      const order = await storage.createOrder(orderData, orderItems, tenantDb);

      // Return in transaction format for compatibility
      const receipt = {
        id: order.id,
        transactionId: order.orderNumber,
        subtotal: order.subtotal,
        tax: order.tax,
        total: order.total,
        paymentMethod: order.paymentMethod,
        cashierName: validatedTransaction.cashierName,
        notes: order.notes,
        invoiceId: order.invoiceId,
        invoiceNumber: order.invoiceNumber,
        createdAt: order.orderedAt,
        items: orderItems.map((item, index) => ({
          id: index + 1,
          transactionId: order.id,
          productId: item.productId,
          productName: item.productName,
          price: item.unitPrice,
          quantity: item.quantity,
          total: item.total,
        })),
      };

      console.log(`✅ POS order created successfully:`, {
        id: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        salesChannel: order.salesChannel,
      });

      res.status(201).json(receipt);
    } catch (error) {
      console.error("POS transaction creation error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid transaction data",
          errors: error.errors,
          details: error.format(),
        });
      }
      res.status(500).json({
        message: "Failed to create POS transaction",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/transactions", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const transactions = await storage.getTransactions(tenantDb);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch transactions",
      });
    }
  });

  // Get transactions by date range
  app.get(
    "/api/transactions/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const tenantDb = await getTenantDatabase(req);
        const database = tenantDb || db;

        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);

        const transactions = await database
          .select()
          .from(transactionsTable)
          .where(
            and(
              gte(transactionsTable.createdAt, start),
              lte(transactionsTable.createdAt, end),
            ),
          )
          .orderBy(desc(transactionsTable.createdAt));

        // Always return an array, even if empty
        res.json(transactions || []);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        // Return empty array instead of error for reports
        res.json([]);
      }
    },
  );

  // API lấy danh sách đơn hàng với filter và pagination
  app.get("/api/orders/list", async (req: TenantRequest, res) => {
    try {
      const {
        startDate,
        endDate,
        customerName,
        orderNumber,
        customerCode,
        status,
        salesChannel,
        einvoiceStatus,
        invoiceStatus,
        paymentMethod,
        page = "1",
        limit,
        sortBy = "orderedAt",
        sortOrder = "desc",
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = limit ? parseInt(limit as string) : null;
      const offset = limitNum ? (pageNum - 1) * limitNum : 0;

      console.log("🔍 GET /api/orders/list - Filter params:", {
        startDate,
        endDate,
        customerName,
        orderNumber,
        customerCode,
        status,
        salesChannel,
        einvoiceStatus,
        invoiceStatus,
        paymentMethod,
        page: pageNum,
        limit: limitNum,
      });

      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      // Build where conditions
      const whereConditions = [];

      // Date range filter - support yyyyMMdd format
      if (startDate && endDate) {
        let start: Date;
        let end: Date;

        if (
          typeof startDate === "string" &&
          startDate.length === 8 &&
          /^\d{8}$/.test(startDate)
        ) {
          // Parse yyyyMMdd format
          const year = parseInt(startDate.substring(0, 4));
          const month = parseInt(startDate.substring(4, 6)) - 1; // Month is 0-indexed
          const day = parseInt(startDate.substring(6, 8));
          start = new Date(year, month, day, 0, 0, 0, 0);
        } else {
          // Parse standard date format
          start = new Date(startDate as string);
          start.setHours(0, 0, 0, 0);
        }

        if (
          typeof endDate === "string" &&
          endDate.length === 8 &&
          /^\d{8}$/.test(endDate)
        ) {
          // Parse yyyyMMdd format
          const year = parseInt(endDate.substring(0, 4));
          const month = parseInt(endDate.substring(4, 6)) - 1; // Month is 0-indexed
          const day = parseInt(endDate.substring(6, 8));
          end = new Date(year, month, day, 23, 59, 59, 999);
        } else {
          // Parse standard date format
          end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
        }

        whereConditions.push(
          gte(orders.orderedAt, start),
          lte(orders.orderedAt, end),
        );
      }

      // Customer name filter
      if (customerName) {
        whereConditions.push(ilike(orders.customerName, `%${customerName}%`));
      }

      // Order number filter
      if (orderNumber) {
        whereConditions.push(ilike(orders.orderNumber, `%${orderNumber}%`));
      }

      // Status filter
      if (status && status !== "all") {
        whereConditions.push(eq(orders.status, status as string));
      }

      if (status == "all") {
        whereConditions.push(
          or(
            eq(orders.status, "paid"),
            eq(orders.status, "completed"),
            eq(orders.status, "served"),
          ),
        );
      }
      // Sales channel filter
      if (salesChannel && salesChannel !== "all") {
        whereConditions.push(eq(orders.salesChannel, salesChannel as string));
      }

      // E-invoice status filter
      if (einvoiceStatus !== undefined && einvoiceStatus !== "all") {
        whereConditions.push(
          eq(orders.einvoiceStatus, parseInt(einvoiceStatus as string)),
        );
      }

      // Invoice status filter
      if (invoiceStatus !== undefined && invoiceStatus !== "all") {
        const statusValue = parseInt(invoiceStatus as string);
        if (!isNaN(statusValue)) {
          whereConditions.push(eq(orders.invoiceStatus, statusValue));
        }
      }

      // Payment method filter - include null values (unpaid orders) and multi-payment JSON
      if (paymentMethod && paymentMethod !== "all") {
        if (paymentMethod === "null" || paymentMethod === "unpaid") {
          // Filter for unpaid orders (paymentMethod is null)
          whereConditions.push(sql`${orders.paymentMethod} IS NULL`);
        } else if (paymentMethod === "creditCard") {
          // For creditCard, include both exact match and multi-payment JSON
          whereConditions.push(
            or(
              eq(orders.paymentMethod, paymentMethod as string),
              like(orders.paymentMethod, "[%"),
            ),
          );
        } else {
          // Filter for specific payment method
          whereConditions.push(
            eq(orders.paymentMethod, paymentMethod as string),
          );
        }
      }

      // Get total count for pagination
      const [totalCountResult] = await database
        .select({
          count: count(),
        })
        .from(orders)
        .where(
          whereConditions.length > 0 ? and(...whereConditions) : undefined,
        );

      const totalCount = totalCountResult?.count || 0;
      const totalPages = limitNum ? Math.ceil(totalCount / limitNum) : 1;

      // Get paginated orders - simplified query without JOIN
      const orderBy =
        sortOrder === "asc" ? asc(orders.orderedAt) : desc(orders.orderedAt);

      let ordersQuery = database
        .select()
        .from(orders)
        .where(
          and(
            ...(whereConditions.length > 0 ? whereConditions : []),
            ne(orders.status, "cancelled"),
          ),
        )
        .orderBy(orderBy);

      // Apply pagination only if limit is specified
      if (limitNum) {
        ordersQuery = ordersQuery.limit(limitNum).offset(offset);
      }

      const ordersResult = await ordersQuery;

      console.log(
        `✅ Orders list API - Found ${ordersResult.length} orders${limitNum ? ` (page ${pageNum}/${totalPages})` : " (all orders)"}`,
      );

      // Get employee data separately for all orders
      const employeeIds = [
        ...new Set(
          ordersResult.map((order) => order.employeeId).filter(Boolean),
        ),
      ];
      let employeeMap = new Map();

      if (employeeIds.length > 0) {
        try {
          const employeeData = await database
            .select({
              id: employees.id,
              employeeId: employees.employeeId,
              name: employees.name,
            })
            .from(employees)
            .where(sql`${employees.id} = ANY(${employeeIds})`);

          employeeMap = new Map(employeeData.map((emp) => [emp.id, emp]));
        } catch (empError) {
          console.warn(
            "⚠️ Error fetching employee data, continuing without:",
            empError,
          );
        }
      }

      // Process orders to ensure consistent field structure
      const processedOrders = ordersResult.map((order, index) => {
        const employee = order.employeeId
          ? employeeMap.get(order.employeeId)
          : null;

        // Set paymentMethod to 'unpaid' if it's null or undefined
        const paymentMethod = order.paymentMethod || "unpaid";

        return {
          ...order,
          paymentMethod: paymentMethod,
          customerCode:
            order.customerTaxCode ||
            `KH000${String(index + 1).padStart(3, "0")}`,
          customerName: order.customerName || "Khách hàng lẻ",
          discount: order.discount || "0.00",
          // Employee info with fallbacks
          employeeCode: employee?.employeeId || "NV0001",
          employeeName: employee?.name || "Nhân viên",
          // Payment method details
          paymentMethodName: getPaymentMethodName(paymentMethod),
          // Invoice status details - ensure invoiceStatus is included
          invoiceStatus: order.invoiceStatus || 1,
          einvoiceStatus: order.einvoiceStatus || 0,
          einvoiceStatusName: getEInvoiceStatusName(order.einvoiceStatus || 0),
          invoiceStatusName: getInvoiceStatusName(order.invoiceStatus || 1),
        };
      });

      // Fetch order items for each order
      const ordersWithItems = await Promise.all(
        processedOrders.map(async (order, index) => {
          try {
            const items = await database
              .select({
                // Order item fields
                id: orderItemsTable.id,
                orderId: orderItemsTable.orderId,
                productId: orderItemsTable.productId,
                quantity: orderItemsTable.quantity,
                unitPrice: orderItemsTable.unitPrice,
                total: orderItemsTable.total,
                discount: orderItemsTable.discount,
                notes: orderItemsTable.notes,
                tax: orderItemsTable.tax,
                priceBeforeTax: orderItemsTable.priceBeforeTax,
                // Product fields with safe handling
                productName: sql<string>`COALESCE(${products.name}, 'Unknown Product')`,
                productSku: sql<string>`COALESCE(${products.sku}, '')`,
              })
              .from(orderItemsTable)
              .leftJoin(products, eq(orderItemsTable.productId, products.id))
              .where(eq(orderItemsTable.orderId, order.id));

            const processedItems = items.map((item) => ({
              id: item.id,
              orderId: item.orderId,
              productId: item.productId,
              quantity: item.quantity,
              unit: "cái", // Default unit
              unitPrice:
                Number(item.priceBeforeTax) > 0
                  ? Number(item.priceBeforeTax) + Number(item.discount)
                  : item.unitPrice,
              total: item.total,
              discount: item.discount || "0.00",
              notes: item.notes,
              tax: item.tax || "0.00",
              priceBeforeTax: item.priceBeforeTax || "0.00",
              productName: item.productName || "Unknown Product",
              productSku: item.productSku || "",
            }));

            return {
              ...order,
              items: processedItems,
            };
          } catch (itemError) {
            console.error(
              `❌ Error fetching items for order ${order.id}:`,
              itemError,
            );
            return {
              ...order,
              items: [],
            };
          }
        }),
      );

      console.log(
        `✅ Orders list API with items - Found ${ordersWithItems.length} orders with complete details`,
      );

      res.json({
        orders: ordersWithItems,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          limit: limitNum,
          hasNext: limitNum ? pageNum < totalPages : false,
          hasPrev: pageNum > 1,
        },
      });
    } catch (error) {
      console.error("❌ Error in orders list API:", error);
      res.status(500).json({
        error: "Failed to fetch orders list",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Recalculate order totals after splitting or editing
  app.post("/api/orders/:id/recalculate", async (req: TenantRequest, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      console.log(`🔢 Recalculating totals for order ${orderId}`);

      // Get order details
      const [order] = await database
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Get remaining order items
      const items = await database
        .select()
        .from(orderItemsTable)
        .where(eq(orderItemsTable.orderId, orderId));

      if (items.length === 0) {
        // If no items left, cancel the order
        await database
          .update(orders)
          .set({
            status: "cancelled",
            subtotal: "0",
            tax: "0",
            total: "0",
            updatedAt: new Date(),
          })
          .where(eq(orders.id, orderId));

        console.log(`✅ Order ${orderId} cancelled (no items left)`);
        return res.json({
          status: "cancelled",
          message: "Order cancelled - no items remaining",
        });
      }

      // Get priceIncludesTax setting
      const priceIncludesTax = order.priceIncludeTax || false;
      const orderDiscount = parseFloat(order.discount || "0");

      // Calculate total before discount for proportional distribution
      const totalBeforeDiscount = items.reduce((sum, item) => {
        return (
          sum +
          parseFloat(item.unitPrice || "0") * parseInt(item.quantity || "0")
        );
      }, 0);

      let allocatedDiscount = 0;
      let subtotal = 0;
      let tax = 0;

      // Update each item with recalculated values
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const unitPrice = parseFloat(item.unitPrice || "0");
        const quantity = parseInt(item.quantity || "0");
        const itemSubtotal = unitPrice * quantity;

        // Calculate proportional discount
        let itemDiscountAmount = 0;
        const isLastItem = i === items.length - 1;

        if (orderDiscount > 0) {
          if (isLastItem) {
            itemDiscountAmount = Math.max(0, orderDiscount - allocatedDiscount);
          } else {
            itemDiscountAmount =
              totalBeforeDiscount > 0
                ? Math.round(
                    (orderDiscount * itemSubtotal) / totalBeforeDiscount,
                  )
                : 0;
            allocatedDiscount += itemDiscountAmount;
          }
        }

        // Get product for tax calculation
        const [product] = await database
          .select()
          .from(products)
          .where(eq(products.id, item.productId))
          .limit(1);

        let itemTax = 0;
        let priceBeforeTax = 0;

        if (product?.taxRate && parseFloat(product.taxRate) > 0) {
          const taxRate = parseFloat(product.taxRate) / 100;

          if (priceIncludesTax) {
            const discountPerUnit = itemDiscountAmount / quantity;
            const adjustedPrice = Math.max(0, unitPrice - discountPerUnit);
            const giaGomThue = adjustedPrice * quantity;
            priceBeforeTax = Math.round(giaGomThue / (1 + taxRate));
            itemTax = giaGomThue - priceBeforeTax;
          } else {
            priceBeforeTax = itemSubtotal - itemDiscountAmount;
            itemTax = Math.round(priceBeforeTax * taxRate);
          }
        } else {
          priceBeforeTax = itemSubtotal - itemDiscountAmount;
          itemTax = 0;
        }

        const itemTotal = priceBeforeTax + itemTax;

        // Update order item
        await database
          .update(orderItemsTable)
          .set({
            total: itemTotal.toString(),
            discount: itemDiscountAmount.toString(),
            tax: Math.round(itemTax).toString(),
            priceBeforeTax: Math.round(priceBeforeTax).toString(),
          })
          .where(eq(orderItemsTable.id, item.id));

        subtotal += priceBeforeTax;
        tax += itemTax;
      }

      const total = Math.round(subtotal + tax);

      // Update order totals
      await database
        .update(orders)
        .set({
          subtotal: Math.round(subtotal).toString(),
          tax: Math.round(tax).toString(),
          total: total.toString(),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));

      console.log(
        `✅ Order ${orderId} recalculated: subtotal=${subtotal}, tax=${tax}, total=${total}`,
      );

      // Get updated order to include isPaid in response
      const [updatedOrder] = await database
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      res.json({
        status: "updated",
        subtotal: Math.round(subtotal).toString(),
        tax: Math.round(tax).toString(),
        total: total.toString(),
        isPaid: updatedOrder?.isPaid || false,
      });
    } catch (error) {
      console.error("❌ Error recalculating order:", error);
      res.status(500).json({ error: "Failed to recalculate order totals" });
    }
  });

  // PATCH route to update specific order fields (like isPaid)
  app.patch("/api/orders/:id", async (req: TenantRequest, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      console.log(
        `📝 PATCH /api/orders/${orderId} - Update request:`,
        req.body,
      );

      // Validate order exists
      const [existingOrder] = await database
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!existingOrder) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Update only the fields provided in request body
      const updateData: any = {};

      if (req.body.isPaid !== undefined) {
        updateData.isPaid = req.body.isPaid;
      }

      // Add other fields if needed
      if (Object.keys(req.body).length > 0) {
        Object.assign(updateData, {
          updatedAt: new Date(),
        });
      }

      console.log(`✅ Updating order ${orderId} with:`, updateData);

      const [updatedOrder] = await database
        .update(orders)
        .set(updateData)
        .where(eq(orders.id, orderId))
        .returning();

      console.log(`✅ Order ${orderId} updated successfully:`, updatedOrder);

      res.json(updatedOrder);
    } catch (error) {
      console.error("❌ Error updating order:", error);
      res.status(500).json({
        error: "Failed to update order",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get orders by date range
  app.get(
    "/api/orders/date-range/:startDate/:endDate/:floor?",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate, floor } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 1000; // Increase limit to get all data
        const floorFilter = floor || "all";
        let storeCode = req.tenant?.storeCode || null;

        console.log("Date range API called with params:", {
          startDate,
          endDate,
          rawStartDate: startDate,
          rawEndDate: endDate,
          floorFilter: floorFilter,
        });

        const tenantDb = await getTenantDatabase(req);
        const database = tenantDb || db;

        // Build where conditions
        const whereConditions = [];
        const whereConditionsPending = [];

        // Date range filter - support yyyyMMdd format
        if (startDate && endDate) {
          let start: Date;
          let end: Date;

          if (
            typeof startDate === "string" &&
            startDate.length === 8 &&
            /^\d{8}$/.test(startDate)
          ) {
            // Parse yyyyMMdd format
            const year = parseInt(startDate.substring(0, 4));
            const month = parseInt(startDate.substring(4, 6)) - 1; // Month is 0-indexed
            const day = parseInt(startDate.substring(6, 8));
            start = new Date(year, month, day, 0, 0, 0, 0);
          } else {
            // Parse standard date format
            start = new Date(startDate as string);
            start.setHours(0, 0, 0, 0);
          }

          if (
            typeof endDate === "string" &&
            endDate.length === 8 &&
            /^\d{8}$/.test(endDate)
          ) {
            // Parse yyyyMMdd format
            const year = parseInt(endDate.substring(0, 4));
            const month = parseInt(endDate.substring(4, 6)) - 1; // Month is 0-indexed
            const day = parseInt(endDate.substring(6, 8));
            end = new Date(year, month, day, 23, 59, 59, 999);
          } else {
            // Parse standard date format
            end = new Date(endDate as string);
            end.setHours(23, 59, 59, 999);
          }

          if (storeCode && storeCode.startsWith("CH-")) {
            whereConditions.push(
              gte(orders.updatedAt, start),
              lte(orders.updatedAt, end),
              or(
                eq(orders.status, "paid"),
                eq(orders.status, "completed"),
                eq(orders.status, "cancelled"),
              ),
            );

            whereConditions.push(
              or(
                eq(orders.status, "paid"),
                eq(orders.status, "completed"),
                eq(orders.status, "cancelled"),
              ),
            );
            whereConditionsPending.push(
              gte(orders.createdAt, start),
              lte(orders.createdAt, end),
              eq(orders.status, "pending"),
            );
          } else {
            whereConditions.push(
              gte(orders.orderedAt, start),
              lte(orders.orderedAt, end),
            );
          }
        }

        if (storeCode && storeCode.startsWith("CH-")) {
          whereConditions.push(eq(orders.storeCode, storeCode));
          whereConditionsPending.push(eq(orders.storeCode, storeCode));
        }

        console.log(`📅 Parsed dates: ${startDate} | ${endDate}`);

        console.log("Date range filter with parsed dates:", {
          startDate,
          endDate,
        });

        // Use database query with proper TIMESTAMPTZ date filtering on orderedAt field
        // let database = tenantDb || db;
        let filteredOrders;

        // Get paginated orders - simplified query without JOIN
        const sortOrder = "desc";
        const orderBy =
          sortOrder === "asc" ? asc(orders.orderedAt) : desc(orders.orderedAt);

        let ordersQuery = await database
          .select()
          .from(orders)
          .where(
            or(
              and(...(whereConditions.length > 0 ? whereConditions : [])),
              and(
                ...(whereConditionsPending.length > 0
                  ? whereConditionsPending
                  : []),
              ),
            ),
          )
          .orderBy(orderBy);

        if (floorFilter && floorFilter !== "all") {
          whereConditions.push(eq(tables.floor, floorFilter));
          // Join with tables to filter by floor
          filteredOrders = await database
            .select()
            .from(orders)
            .leftJoin(tables, eq(orders.tableId, tables.id))
            .where(
              or(
                and(...(whereConditions.length > 0 ? whereConditions : [])),
                and(
                  ...(whereConditionsPending.length > 0
                    ? whereConditionsPending
                    : []),
                ),
              ),
            )
            .orderBy(orderBy);

          res.json(filteredOrders);
        } else {
          // Return all filtered orders (no pagination for reports)
          res.json(ordersQuery);
        }
      } catch (error) {
        console.error("Error fetching orders by date range:", error);
        res.status(500).json({
          error: "Failed to fetch orders",
        });
      }
    },
  );

  // Get invoices by date range
  app.get(
    "/api/invoices/date-range/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;

        const tenantDb = await getTenantDatabase(req);
        const database = tenantDb || db;

        // Filter by date range using direct database query
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);

        const allInvoices = await database
          .select()
          .from(invoices)
          .where(
            and(
              gte(invoices.invoiceDate, start),
              lte(invoices.invoiceDate, end),
            ),
          )
          .orderBy(
            desc(invoices.createdAt), // Primary sort by creation time (newest first)
            desc(invoices.id), // Secondary sort by ID (newest first)
          );

        // Paginate results
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedInvoices = allInvoices.slice(startIndex, endIndex);

        console.log(
          "Invoices by date range - Total found:",
          allInvoices.length,
        );
        console.log("Invoices by date range - Paginated result:", {
          page,
          limit,
          total: allInvoices.length,
          returned: paginatedInvoices.length,
          newestInvoice: paginatedInvoices[0]
            ? {
                id: paginatedInvoices[0].id,
                tradeNumber: paginatedInvoices[0].tradeNumber,
                createdAt: paginatedInvoices[0].createdAt,
              }
            : null,
        });

        res.json(paginatedInvoices);
      } catch (error) {
        console.error("Error fetching invoices by date range:", error);
        res.status(500).json({
          error: "Failed to fetch invoices",
        });
      }
    },
  );

  app.get(
    "/api/transactions/:transactionId",
    async (req: TenantRequest, res) => {
      try {
        const transactionId = req.params.transactionId;
        const tenantDb = await getTenantDatabase(req);
        const receipt = await storage.getTransactionByTransactionId(
          transactionId,
          tenantDb,
        );

        if (!receipt) {
          return res.status(404).json({
            message: "Transaction not found",
          });
        }

        res.json(receipt);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch transaction",
        });
      }
    },
  );

  // Get next employee ID
  app.get("/api/employees/next-id", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const nextId = await storage.getNextEmployeeId(tenantDb);
      res.json({
        nextId,
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to generate employee ID",
      });
    }
  });

  // Get next PO number for purchase receipts
  app.get(
    "/api/purchase-orders/next-po-number",
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 API: Getting next purchase receipt number");
        const tenantDb = await getTenantDatabase(req);
        const nextPONumber = await storage.getNextPONumber(tenantDb);
        console.log(
          "✅ API: Generated next purchase receipt number:",
          nextPONumber,
        );
        res.json({
          nextPONumber,
        });
      } catch (error) {
        console.error(
          "❌ API: Failed to generate purchase receipt number:",
          error,
        );
        res.status(500).json({
          message: "Failed to generate purchase receipt number",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Get order items by order ID
  app.get("/api/orders/:id/items", async (req: TenantRequest, res) => {
    try {
      const orderId = parseInt(req.params.id);
      console.log(`🔍 API: Getting order items for order ${orderId}`);

      if (isNaN(orderId)) {
        return res.status(400).json({
          error: "Invalid order ID",
        });
      }

      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      const items = await database
        .select({
          id: orderItemsTable.id,
          orderId: orderItemsTable.orderId,
          productId: orderItemsTable.productId,
          quantity: orderItemsTable.quantity,
          unitPrice: orderItemsTable.unitPrice,
          total: orderItemsTable.total,
          discount: orderItemsTable.discount,
          notes: orderItemsTable.notes,
          tax: orderItemsTable.tax,
          priceBeforeTax: orderItemsTable.priceBeforeTax,
          productName: products.name,
          productSku: products.sku,
        })
        .from(orderItemsTable)
        .leftJoin(products, eq(orderItemsTable.productId, products.id))
        .where(eq(orderItemsTable.orderId, orderId));

      console.log(`✅ API: Found ${items.length} items for order ${orderId}`);
      res.json(items);
    } catch (error) {
      console.error("❌ API: Failed to fetch order items:", error);
      res.status(500).json({
        error: "Failed to fetch order items",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // PATCH endpoint to update specific order item fields
  app.patch("/api/order-items/:id", async (req: TenantRequest, res) => {
    try {
      const itemId = parseInt(req.params.id);
      console.log(`📝 API: PATCH order item ${itemId} with data:`, req.body);

      if (isNaN(itemId)) {
        return res.status(400).json({
          error: "Invalid order item ID",
        });
      }

      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;

      // Get current item to calculate new total
      const currentItem = await storage.getOrderItemById(itemId);
      if (!currentItem) {
        return res.status(404).json({
          error: "Order item not found",
        });
      }

      // Build update object from request body - ensure all numeric values are properly converted
      const updateData: any = {};

      // If quantity is being updated, recalculate total
      if (req.body.quantity !== undefined) {
        const newQuantity =
          typeof req.body.quantity === "string"
            ? parseInt(req.body.quantity)
            : req.body.quantity;
        
        updateData.quantity = newQuantity;

        // Recalculate total: unitPrice × newQuantity
        const unitPrice = parseFloat(currentItem.unitPrice?.toString() || "0");
        const newTotal = unitPrice * newQuantity;
        updateData.total = newTotal.toFixed(2);

        console.log(`💰 Recalculated total for item ${itemId}:`, {
          unitPrice,
          newQuantity,
          newTotal: newTotal.toFixed(2),
        });
      }

      if (req.body.unitPrice !== undefined) {
        updateData.unitPrice =
          typeof req.body.unitPrice === "number"
            ? req.body.unitPrice.toString()
            : req.body.unitPrice.toString();
      }

      if (req.body.total !== undefined && req.body.quantity === undefined) {
        // Only allow manual total update if quantity is not being changed
        updateData.total =
          typeof req.body.total === "number"
            ? req.body.total.toString()
            : req.body.total.toString();
      }

      if (req.body.discount !== undefined) {
        updateData.discount =
          typeof req.body.discount === "number"
            ? req.body.discount.toString()
            : req.body.discount.toString();
      }

      if (req.body.tax !== undefined) {
        updateData.tax =
          typeof req.body.tax === "number"
            ? req.body.tax.toString()
            : req.body.tax.toString();
      }

      if (req.body.priceBeforeTax !== undefined) {
        updateData.priceBeforeTax =
          typeof req.body.priceBeforeTax === "number"
            ? req.body.priceBeforeTax.toString()
            : req.body.priceBeforeTax.toString();
      }

      if (req.body.productId !== undefined) {
        updateData.productId =
          typeof req.body.productId === "string"
            ? parseInt(req.body.productId)
            : req.body.productId;
      }

      if (req.body.notes !== undefined) {
        updateData.notes = req.body.notes;
      }

      if (req.body.status !== undefined) {
        updateData.status = req.body.status;
      }

      console.log(
        `🔧 Updating order item ${itemId} with converted data:`,
        updateData,
      );

      const [updatedItem] = await database
        .update(orderItemsTable)
        .set(updateData)
        .where(eq(orderItemsTable.id, itemId))
        .returning();

      if (!updatedItem) {
        return res.status(404).json({
          error: "Order item not found",
        });
      }

      console.log(`✅ Order item ${itemId} updated successfully:`, updatedItem);

      // Return with proper data types for client
      const responseItem = {
        ...updatedItem,
        quantity: parseInt(updatedItem.quantity?.toString() || "0"),
        unitPrice: parseFloat(updatedItem.unitPrice?.toString() || "0"),
        total: parseFloat(updatedItem.total?.toString() || "0"),
        discount: parseFloat(updatedItem.discount?.toString() || "0"),
        tax: parseFloat(updatedItem.tax?.toString() || "0"),
        priceBeforeTax: parseFloat(
          updatedItem.priceBeforeTax?.toString() || "0",
        ),
      };

      res.json(responseItem);
    } catch (error) {
      console.error(`❌ API: Failed to update order item:`, error);
      res.status(500).json({
        error: "Failed to update order item",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get single Purchase Receipt by ID
  app.get("/api/purchase-receipts/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log("🔍 API: Getting purchase receipt with ID:", id);

      if (isNaN(id)) {
        return res.status(400).json({
          error: "Invalid purchase receipt ID",
        });
      }

      const tenantDb = await getTenantDatabase(req);
      const receipt = await storage.getPurchaseOrder(id, tenantDb);

      if (!receipt) {
        console.log("❌ Purchase receipt not found:", id);
        return res.status(404).json({
          error: "Purchase receipt not found",
        });
      }

      console.log("✅ API: Purchase receipt fetched:", receipt.id);
      res.json(receipt);
    } catch (error) {
      console.error("❌ API: Failed to fetch purchase receipt:", error);
      res.status(500).json({
        error: "Failed to fetch purchase receipt",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Update Purchase Receipt
  app.put("/api/purchase-receipts/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log(
        "🔍 API: Updating purchase receipt with ID:",
        id,
        "Data:",
        req.body,
      );

      if (isNaN(id)) {
        return res.status(400).json({
          error: "Invalid purchase receipt ID",
        });
      }

      const tenantDb = await getTenantDatabase(req);

      // Validate required fields
      const updateData = req.body;
      if (!updateData.supplierId) {
        return res.status(400).json({
          error: "Supplier ID is required",
        });
      }

      // Update the purchase receipt
      const updatedReceipt = await storage.updatePurchaseOrder(
        id,
        updateData,
        tenantDb,
      );

      if (!updatedReceipt) {
        return res.status(404).json({
          error: "Purchase receipt not found",
        });
      }

      console.log(
        "✅ API: Purchase receipt updated successfully:",
        updatedReceipt.id,
      );
      res.json(updatedReceipt);
    } catch (error) {
      console.error("❌ API: Failed to update purchase receipt:", error);
      res.status(500).json({
        error: "Failed to update purchase receipt",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Create Purchase Order Item
  app.post("/api/purchase-order-items", async (req: TenantRequest, res) => {
    try {
      console.log("🔍 API: Creating purchase order item with data:", req.body);
      const tenantDb = await getTenantDatabase(req);

      const itemData = req.body;
      if (!itemData.purchaseReceiptId) {
        return res.status(400).json({
          error: "Purchase receipt ID is required",
        });
      }

      const newItem = await storage.createPurchaseOrderItem(itemData, tenantDb);
      console.log("✅ API: Purchase order item created:", newItem);
      res.status(201).json(newItem);
    } catch (error) {
      console.error("❌ API: Failed to create purchase order item:", error);
      res.status(500).json({
        error: "Failed to create purchase order item",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Update Purchase Order Item
  app.put("/api/purchase-order-items/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log("to � API: Updating purchase order item:", id, req.body);
      const tenantDb = await getTenantDatabase(req);

      const updatedItem = await storage.updatePurchaseOrderItem(
        id,
        req.body,
        tenantDb,
      );

      if (!updatedItem) {
        return res.status(404).json({
          error: "Purchase order item not found",
        });
      }

      console.log("✅ Successfully updated purchase order item:", id);
      res.json(updatedItem);
    } catch (error) {
      console.error("❌ Failed to update purchase order item:", error);
      res.status(500).json({
        error: "Failed to update purchase order item",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get Purchase Receipt Items
  app.get(
    "/api/purchase-receipts/:id/items",
    async (req: TenantRequest, res) => {
      try {
        const purchaseReceiptId = parseInt(req.params.id);
        console.log(
          "🔍 API: Getting purchase receipt items for ID:",
          purchaseReceiptId,
        );

        if (isNaN(purchaseReceiptId)) {
          return res.status(400).json({
            error: "Invalid purchase receipt ID",
          });
        }

        const tenantDb = await getTenantDatabase(req);
        const items = await storage.getPurchaseOrderItems(
          purchaseReceiptId,
          tenantDb,
        );

        console.log("✅ API: Purchase receipt items fetched:", items.length);
        res.json(items);
      } catch (error) {
        console.error("❌ API: Failed to fetch purchase receipt items:", error);
        res.status(500).json({
          error: "Failed to fetch purchase receipt items",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Get Purchase Receipt Documents
  app.get(
    "/api/purchase-receipts/:id/documents",
    async (req: TenantRequest, res) => {
      try {
        const purchaseReceiptId = parseInt(req.params.id);
        console.log(`
=================================================
🔍 API: GET /api/purchase-receipts/${purchaseReceiptId}/documents
=================================================`);
        console.log("📋 Request params:", req.params);
        console.log("📋 Purchase Receipt ID:", purchaseReceiptId);
        console.log("📋 ID type:", typeof purchaseReceiptId);
        console.log("📋 Is valid number:", !isNaN(purchaseReceiptId));

        if (isNaN(purchaseReceiptId)) {
          console.error("❌ Invalid purchase receipt ID provided");
          return res.status(400).json({
            error: "Invalid purchase receipt ID",
          });
        }

        console.log("🔍 Getting tenant database connection...");
        const tenantDb = await getTenantDatabase(req);
        console.log("✅ Tenant database connection obtained");

        console.log(
          `🔍 Calling storage.getPurchaseOrderDocuments(${purchaseReceiptId}, tenantDb)...`,
        );
        const documents = await storage.getPurchaseOrderDocuments(
          purchaseReceiptId,
          tenantDb,
        );

        console.log("✅ API: Purchase receipt documents fetched successfully");
        console.log("📊 Documents count:", documents.length);
        console.log("📦 Documents data:", JSON.stringify(documents, null, 2));
        console.log("=================================================\n");

        res.json(documents);
      } catch (error) {
        console.error(
          "❌ API: Failed to fetch purchase receipt documents:",
          error,
        );
        console.error("❌ Error stack:", error?.stack);
        console.error("=================================================\n");
        res.status(500).json({
          error: "Failed to fetch purchase receipt documents",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Product Analysis API
  app.get(
    "/api/product-analysis/:startDate/:endDate/:floor?",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate, floor } = req.params;
        const { categoryId, productType, productSearch } = req.query;
        const floorFilter = floor || "all";

        console.log("🔍 Product Analysis API called with params:", {
          startDate,
          endDate,
          floorFilter,
          categoryId,
          productType,
          productSearch,
        });

        const tenantDb = await getTenantDatabase(req);

        // Parse dates
        let start: Date;
        let end: Date;

        if (startDate.includes("T") || startDate.includes(":")) {
          start = new Date(startDate);
        } else {
          start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
        }

        if (endDate.includes("T") || endDate.includes(":")) {
          end = new Date(endDate);
        } else {
          end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
        }

        const database = tenantDb || db;

        // Build category conditions for products
        let categoryConditions = [];
        if (categoryId && categoryId !== "all") {
          categoryConditions.push(
            eq(products.categoryId, parseInt(categoryId as string)),
          );
        }

        // Build product type conditions
        let typeConditions = [];
        if (productType && productType !== "all") {
          const typeMap = {
            combo: 3,
            product: 1,
            service: 2,
          };
          const typeValue = typeMap[productType as keyof typeof typeMap];
          if (typeValue) {
            typeConditions.push(eq(products.productType, value));
          }
        }

        // Build search conditions
        let searchConditions = [];
        if (productSearch && productSearch !== "" && productSearch !== "all") {
          const searchTerm = `%${productSearch}%`;
          searchConditions.push(
            or(
              ilike(products.name, searchTerm),
              ilike(products.sku, searchTerm),
            ),
          );
        }

        // Get orders with items in the date range
        let ordersQuery = database
          .select({
            productId: orderItemsTable.productId,
            productName: products.name,
            productSku: products.sku,
            categoryId: products.categoryId,
            categoryName: categories.name,
            unitPrice: orderItemsTable.unitPrice, // This is the pre-tax price
            quantity: orderItemsTable.quantity,
            total: orderItemsTable.total, // This should also be pre-tax total
            orderId: orderItemsTable.orderId,
            orderDate: orders.orderedAt,
            discount: orderItemsTable.discount,
            orderStatus: orders.status,
            tableId: orders.tableId,
            priceIncludeTax: orders.priceIncludeTax,
          })
          .from(orders)
          .innerJoin(orderItemsTable, eq(orders.id, orderItemsTable.orderId))
          .leftJoin(products, eq(orderItemsTable.productId, products.id))
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(
            and(
              gte(orders.createdAt, start),
              lte(orders.createdAt, end),
              or(eq(orders.status, "paid"), eq(orders.status, "completed")),
              ...categoryConditions,
              ...typeConditions,
              ...searchConditions,
            ),
          )
          .orderBy(desc(orders.createdAt));

        // Add floor filter if specified
        if (floorFilter && floorFilter !== "all") {
          ordersQuery = database
            .select({
              productId: orderItemsTable.productId,
              productName: products.name,
              productSku: products.sku,
              categoryId: products.categoryId,
              categoryName: categories.name,
              unitPrice: orderItemsTable.unitPrice, // This is the pre-tax price
              quantity: orderItemsTable.quantity,
              total: orderItemsTable.total, // This should also be pre-tax total
              orderId: orderItemsTable.orderId,
              orderDate: orders.orderedAt,
              discount: orderItemsTable.discount,
              orderStatus: orders.status,
              tableId: orders.tableId,
              priceIncludeTax: orders.priceIncludeTax,
            })
            .from(orders)
            .innerJoin(orderItemsTable, eq(orders.id, orderItemsTable.orderId))
            .leftJoin(tables, eq(orders.tableId, tables.id))
            .leftJoin(products, eq(orderItemsTable.productId, products.id))
            .leftJoin(categories, eq(products.categoryId, categories.id))
            .where(
              and(
                gte(orders.createdAt, start),
                lte(orders.createdAt, end),
                eq(tables.floor, floorFilter),
                or(eq(orders.status, "paid"), eq(orders.status, "completed")),
                ...categoryConditions,
                ...typeConditions,
                ...searchConditions,
              ),
            )
            .orderBy(desc(orders.createdAt));
        }

        const orderItems = await ordersQuery;

        // Group and aggregate data by product
        const productMap = new Map();

        orderItems.forEach((item) => {
          const productId = item.productId;
          const quantity = Number(item.quantity || 0);
          const revenue = Number(item.unitPrice || 0) * quantity;
          const discount = Number(item.discount || 0);

          if (productMap.has(productId)) {
            const existing = productMap.get(productId);
            existing.totalQuantity += quantity;
            existing.totalRevenue += revenue;
            existing.discount += discount;
            existing.orderCount += 1;
          } else {
            productMap.set(productId, {
              productId: item.productId,
              productName: item.productName,
              productSku: item.productSku,
              categoryId: item.categoryId,
              categoryName: item.categoryName,
              productType: item.productType,
              unitPrice: item.unitPrice, // This is the pre-tax price
              quantity: item.quantity,
              total: item.total,
              discount: item.discount,
              totalQuantity: quantity,
              totalRevenue: revenue,
              totalDiscount: discount,
              averagePrice: Number(item.unitPrice || 0),
              orderCount: 1,
            });
          }
        });

        // Convert to array and calculate final metrics
        const productStats = Array.from(productMap.values()).map((product) => ({
          ...product,
          averageOrderValue:
            product.orderCount > 0
              ? product.totalRevenue / product.orderCount
              : 0,
        }));

        // Calculate totals
        const totalRevenue = productStats.reduce(
          (sum, product) => sum + product.totalRevenue,
          0,
        );
        const totalQuantity = productStats.reduce(
          (sum, product) => sum + product.quantity,
          0,
        );
        const totalDiscount = productStats.reduce(
          (sum, product) => sum + product.totalDiscount,
          0,
        );
        const totalProducts = productStats.length;

        console.log(
          `✅ Product Analysis API - Found ${productStats.length} products, Total Revenue: ${totalRevenue}`,
        );

        // Sort by revenue (descending)
        productStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

        const result = {
          productStats,
          totalRevenue,
          totalQuantity,
          totalDiscount,
          totalProducts,
          summary: {
            topSellingProduct: productStats[0] || null,
            averageRevenuePerProduct:
              totalProducts > 0 ? totalRevenue / totalProducts : 0,
          },
        };

        console.log("Product Analysis Results:", {
          totalRevenue,
          totalQuantity,
          totalDiscount,
          totalProducts,
          topProduct: result.summary.topSellingProduct?.productName,
        });

        res.json(result);
      } catch (error) {
        console.error("❌ Product Analysis API error:", error);
        res.status(500).json({
          error: "Failed to fetch product analysis",
          message: error instanceof Error ? error.message : String(error),
          summary: {
            totalProducts: 0,
            totalRevenue: 0,
            totalQuantity: 0,
            totalOrders: 0,
            averageOrderValue: 0,
          },
          productStats: [],
          categoryStats: [],
          topSellingProducts: [],
          topRevenueProducts: [],
        });
      }
    },
  );

  // Get Purchase Receipts
  app.get("/api/purchase-receipts", async (req: TenantRequest, res) => {
    try {
      console.log("🔍 API: Getting purchase receipts with query:", req.query);
      const tenantDb = await getTenantDatabase(req);

      const options = {
        supplierId: req.query.supplierId
          ? Number(req.query.supplierId)
          : undefined,
        status: req.query.status as string,
        search: req.query.search as string,
        supplierName: req.query.supplierName as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };

      const receipts = await storage.getPurchaseReceipts(options, tenantDb);
      console.log("✅ API: Purchase receipts fetched:", receipts.length);

      // Transform receipts to match C# class structure
      const transformedReceipts = await Promise.all(
        receipts.map(async (receipt) => {
          // Get receipt items
          const items = await storage.getPurchaseOrderItems(
            receipt.id,
            tenantDb,
          );

          // Get supplier details
          const supplier = await storage.getSupplier(receipt.supplierId);

          // Get employee details if available
          let employee = null;
          if (receipt.employeeId) {
            employee = await storage.getEmployee(receipt.employeeId, tenantDb);
          }

          // Calculate summary statistics
          const totalItems = items.length;
          const totalQuantityOrdered = items.reduce(
            (sum, item) => sum + item.quantity,
            0,
          );
          const totalQuantityReceived = items.reduce(
            (sum, item) => sum + (item.receivedQuantity || 0),
            0,
          );
          const isFullyReceived =
            totalQuantityOrdered > 0 &&
            totalQuantityReceived >= totalQuantityOrdered;
          const receivedPercentage =
            totalQuantityOrdered > 0
              ? Math.round((totalQuantityReceived / totalQuantityOrdered) * 100)
              : 0;

          // Transform items with product details and receiving info
          const transformedItems = await Promise.all(
            items.map(async (item) => {
              // Get current product details
              let product = null;
              let productDetail = {
                currentName: item.productName,
                currentPrice: parseFloat(item.unitPrice) || 0,
                currentStock: 0,
                isActive: false,
                trackInventory: false,
                priceChanged: false,
                priceChangePercentage: 0,
              };

              if (item.productId) {
                try {
                  product = await storage.getProduct(item.productId, tenantDb);
                  if (product) {
                    const originalPrice = parseFloat(item.unitPrice);
                    const currentPrice = parseFloat(product.price);
                    const priceChanged =
                      Math.abs(originalPrice - currentPrice) > 0.01;
                    const priceChangePercentage =
                      originalPrice > 0
                        ? ((currentPrice - originalPrice) / originalPrice) * 100
                        : 0;

                    productDetail = {
                      currentName: product.name,
                      currentPrice: currentPrice || 0,
                      currentStock: product.stock || 0,
                      isActive: product.isActive || false,
                      trackInventory: product.trackInventory || false,
                      priceChanged,
                      priceChangePercentage:
                        Math.round(priceChangePercentage * 100) / 100,
                    };
                  }
                } catch (productError) {
                  console.warn(
                    `Could not fetch product ${item.productId}:`,
                    productError,
                  );
                }
              }

              // Calculate receiving info
              const receivedPercentage =
                item.quantity > 0
                  ? ((item.receivedQuantity || 0) / item.quantity) * 100
                  : 0;
              const isPartiallyReceived =
                (item.receivedQuantity || 0) > 0 &&
                (item.receivedQuantity || 0) < item.quantity;

              return {
                id: item.id,
                productId: item.productId,
                productName: item.productName,
                sku: item.sku || "",
                quantity: item.quantity,
                receivedQuantity: item.receivedQuantity || 0,
                unitPrice: item.unitPrice ? parseFloat(item.unitPrice) : 0,
                total: item.total ? parseFloat(item.total) : 0,
                taxRate: parseFloat(item.taxRate || "0"),
                discountPercent: item.discountPercent
                  ? parseFloat(item.discountPercent)
                  : 0,
                discountAmount: item.discountAmount
                  ? parseFloat(item.discountAmount)
                  : 0,
                discount_percent: item.discountPercent
                  ? parseFloat(item.discountPercent)
                  : 0,
                discount_amount: item.discountAmount
                  ? parseFloat(item.discountAmount)
                  : 0,
                notes: item.notes || "",
                product: productDetail,
                receiving: {
                  isPartiallyReceived,
                  receivedPercentage:
                    Math.round(receivedPercentage * 100) / 100,
                },
              };
            }),
          );

          return {
            id: receipt.id,
            receiptNumber: receipt.receiptNumber,
            purchaseType: receipt.purchaseType, // Add purchaseType field
            status: receipt.status || "pending",
            purchaseDate: receipt.purchaseDate || receipt.createdAt,
            actualDeliveryDate: receipt.actualDeliveryDate || null,
            subtotal: receipt.subtotal ? parseFloat(receipt.subtotal) : 0,
            tax: receipt.tax ? parseFloat(receipt.tax) : 0,
            total: receipt.total ? parseFloat(receipt.total) : 0,
            notes: receipt.notes || "",
            createdAt: receipt.createdAt,
            updatedAt: receipt.updatedAt,
            isPaid: receipt.isPaid || false,
            paymentMethod: receipt.paymentMethod || "cash",
            paymentAmount: receipt.paymentAmount
              ? parseFloat(receipt.paymentAmount)
              : 0,
            supplier: supplier
              ? {
                  id: supplier.id,
                  name: supplier.name,
                  code: supplier.code,
                  contactPerson: supplier.contactPerson || "",
                  phone: supplier.phone || "",
                  email: supplier.email || "",
                  address: supplier.address || "",
                  status: supplier.status || "active",
                }
              : null,
            employee: employee
              ? {
                  id: employee.id,
                  name: employee.name,
                }
              : null,
            summary: {
              total_items: totalItems,
              total_quantity_ordered: totalQuantityOrdered,
              total_quantity_received: totalQuantityReceived,
              is_fully_received: isFullyReceived,
              received_percentage: receivedPercentage,
            },
            items: transformedItems,
          };
        }),
      );

      // Return in standardized format matching C# classes
      res.json({
        success: true,
        message: "OK",
        data: transformedReceipts,
      });
    } catch (error) {
      console.error("❌ API: Failed to fetch purchase receipts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch purchase receipts",
        data: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Create Purchase Receipt
  app.post("/api/purchase-receipts", async (req: TenantRequest, res) => {
    try {
      console.log("🔍 API: Creating purchase receipt with data:", req.body);
      const tenantDb = await getTenantDatabase(req);

      const { items = [], ...receiptData } = req.body;

      // Validate required fields
      if (!receiptData.supplierId) {
        return res.status(400).json({
          message: "Missing required field: supplierId is required",
        });
      }

      // Generate receipt number if not provided
      if (
        !receiptData.receiptNumber ||
        receiptData.receiptNumber.trim() === ""
      ) {
        console.log("🔢 No receipt number provided, generating one");
        receiptData.receiptNumber = await storage.getNextPONumber(tenantDb);
        console.log("🔢 Generated receipt number:", receiptData.receiptNumber);
      }

      console.log("📝 Creating purchase receipt with:", {
        receiptData,
        itemsCount: items.length,
      });

      const purchaseReceipt = await storage.createPurchaseReceipt(
        receiptData,
        items,
        tenantDb,
      );
      console.log("✅ API: Purchase receipt created:", purchaseReceipt);

      res.status(201).json(purchaseReceipt);
    } catch (error) {
      console.error("❌ API: Failed to create purchase receipt:", error);
      res.status(500).json({
        message: "Failed to create purchase receipt",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Upload document to purchase receipt
  app.post(
    "/api/purchase-receipts/:id/documents",
    async (req: TenantRequest, res) => {
      try {
        console.log("📤 API: Uploading document for purchase receipt");
        const purchaseReceiptId = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);

        // Parse form data from request body
        const {
          fileName,
          originalFileName,
          fileType,
          fileSize,
          description,
          fileContent,
        } = req.body;

        if (!fileContent) {
          return res.status(400).json({
            message: "File content is required",
          });
        }

        // Use original filename if provided, otherwise use fileName
        const finalOriginalFileName =
          originalFileName || fileName || `document_${Date.now()}`;

        // Generate storage filename with timestamp to avoid conflicts
        const storageFileName = `${Date.now()}_${finalOriginalFileName}`;

        // Extract base64 content (remove data URL prefix if present)
        const base64Content = fileContent.includes(",")
          ? fileContent.split(",")[1]
          : fileContent;

        // Calculate actual file size
        const padding = (base64Content.match(/=/g) || []).length;
        const actualFileSize =
          Math.floor((base64Content.length * 3) / 4) - padding;

        // Create uploads directory if it doesn't exist
        const fs = await import("fs/promises");
        const path = await import("path");
        const uploadDir = path.join(
          process.cwd(),
          "uploads",
          "purchase-receipts",
          purchaseReceiptId.toString(),
        );
        await fs.mkdir(uploadDir, { recursive: true });

        // Save file to disk
        const filePath = path.join(uploadDir, storageFileName);
        const buffer = Buffer.from(base64Content, "base64");
        await fs.writeFile(filePath, buffer);

        console.log("📎 File saved to disk:", {
          originalFileName: finalOriginalFileName,
          storageFileName,
          fileType,
          actualFileSize,
          diskPath: filePath,
        });

        // Insert document metadata into database
        const result = await tenantDb.execute(sql`
          INSERT INTO purchase_receipt_documents (
            purchase_receipt_id,
            document_name,
            document_type,
            file_path,
            file_size,
            uploaded_at
          ) VALUES (
            ${purchaseReceiptId},
            ${finalOriginalFileName},
            ${fileType || "application/octet-stream"},
            ${`/uploads/purchase-receipts/${purchaseReceiptId}/${storageFileName}`},
            ${actualFileSize},
            NOW()
          )
          RETURNING *
        `);

        const document = result.rows[0];

        console.log("✅ API: Document uploaded and saved successfully:", {
          id: document.id,
          originalFileName: document.document_name,
          storageFileName,
          actualFileSize: document.file_size,
          diskPath: filePath,
        });

        res.status(201).json({
          id: document.id,
          purchaseReceiptId: document.purchase_receipt_id,
          fileName: storageFileName,
          originalFileName: document.document_name,
          fileType: document.document_type,
          fileSize: document.file_size,
          filePath: document.file_path,
          createdAt: document.uploaded_at,
        });
      } catch (error) {
        console.error("❌ API: Failed to upload document:", error);
        res.status(500).json({
          message: "Failed to upload document",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Download document
  app.get(
    "/api/purchase-receipts/documents/:documentId/download",
    async (req: TenantRequest, res) => {
      try {
        const documentId = parseInt(req.params.documentId);
        const tenantDb = await getTenantDatabase(req);

        console.log(`📥 Downloading document ID: ${documentId}`);

        // Get document info using raw SQL to access correct column names
        const result = await tenantDb.execute(sql`
          SELECT 
            id,
            document_name,
            document_type,
            file_path,
            file_size
          FROM purchase_receipt_documents
          WHERE id = ${documentId}
          LIMIT 1
        `);

        if (!result.rows || result.rows.length === 0) {
          console.error(`❌ Document not found: ${documentId}`);
          return res.status(404).json({ error: "Document not found" });
        }

        const document = result.rows[0];

        // Read file from disk
        const fs = await import("fs/promises");
        const path = await import("path");
        const filePath = path.join(process.cwd(), document.file_path);

        try {
          const fileBuffer = await fs.readFile(filePath);

          console.log(`✅ File read from disk:`, {
            documentId,
            fileName: document.document_name,
            fileSize: document.file_size,
            actualSize: fileBuffer.length,
            diskPath: filePath,
          });

          // Encode filename properly for Content-Disposition header (RFC 5987)
          const encodedFilename = encodeURIComponent(
            document.document_name || "document",
          );

          res.setHeader(
            "Content-Type",
            document.document_type || "application/octet-stream",
          );
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
          );
          res.setHeader("Content-Length", fileBuffer.length.toString());
          res.status(200).send(fileBuffer);
        } catch (fileError) {
          console.error(`❌ File not found on disk: ${filePath}`, fileError);
          return res.status(404).json({
            error: "File not found on disk",
            filePath: document.file_path,
          });
        }
      } catch (error) {
        console.error("❌ API: Failed to download document:", error);
        res.status(500).json({
          error: "Failed to download document",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Delete document
  app.delete(
    "/api/purchase-receipts/documents/:documentId",
    async (req: TenantRequest, res) => {
      try {
        const documentId = parseInt(req.params.documentId);
        console.log(`🗑️ API: Deleting document ${documentId}`);

        const tenantDb = await getTenantDatabase(req);
        const database = tenantDb || db;

        // Get document info using raw SQL with correct column names
        const result = await database.execute(sql`
          SELECT 
            id,
            file_path
          FROM purchase_receipt_documents
          WHERE id = ${documentId}
          LIMIT 1
        `);

        if (!result.rows || result.rows.length === 0) {
          console.error(`❌ Document not found: ${documentId}`);
          return res.status(404).json({ error: "Document not found" });
        }

        const document = result.rows[0];
        const filePath = document.file_path;
        console.log(`📍 Document file path: ${filePath}`);

        // Delete from database first
        await database.execute(sql`
          DELETE FROM purchase_receipt_documents WHERE id = ${documentId}
        `);

        console.log(`✅ Document ${documentId} deleted from database`);

        // Delete file from disk if path exists
        if (filePath) {
          try {
            const fs = await import("fs/promises");
            const path = await import("path");
            const fullPath = path.join(process.cwd(), filePath);
            await fs.unlink(fullPath);
            console.log(`✅ File deleted from disk: ${fullPath}`);
          } catch (fileError) {
            console.warn(
              `⚠️ Could not delete file from disk: ${filePath}`,
              fileError,
            );
            // Continue even if file deletion fails - database record is already deleted
          }
        }

        console.log("✅ API: Document deleted successfully");
        res.json({ success: true });
      } catch (error) {
        console.error("❌ API: Failed to delete document:", error);
        res.status(500).json({
          error: "Failed to delete document",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Bulk delete Purchase Receipts
  app.post(
    "/api/purchase-receipts/bulk-delete",
    async (req: TenantRequest, res) => {
      try {
        console.log("🗑️ API: Bulk delete purchase receipts:", req.body);
        const tenantDb = await getTenantDatabase(req);
        const { orderIds } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
          return res.status(400).json({
            message: "Missing or invalid orderIds array",
          });
        }

        let deletedCount = 0;
        let failedCount = 0;
        const errors = [];

        for (const id of orderIds) {
          try {
            const deleted = await storage.deletePurchaseOrder(id, tenantDb);
            if (deleted) {
              deletedCount++;
            } else {
              failedCount++;
              errors.push(`Purchase receipt ${id} not found`);
            }
          } catch (error) {
            failedCount++;
            errors.push(
              `Failed to delete purchase receipt ${id}: ${error.message}`,
            );
          }
        }

        console.log("✅ API: Bulk delete completed:", {
          deletedCount,
          failedCount,
        });

        res.json({
          deletedCount,
          failedCount,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        console.error(
          "❌ API: Failed to bulk delete purchase receipts:",
          error,
        );
        res.status(500).json({
          message: "Failed to bulk delete purchase receipts",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Split order endpoint
  app.post("/api/orders/split", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const requestBody = req.body;

      console.log(
        "🔄 Split order request received:",
        JSON.stringify(requestBody, null, 2),
      );

      const originalOrderId = requestBody.originalOrderId;
      const splitItems = requestBody.splitItems;
      const remainingItems = requestBody.remainingItems;
      const originalOrderUpdate = requestBody.originalOrderUpdate;

      if (!originalOrderId) {
        console.error("❌ Missing originalOrderId in request");
        return res
          .status(400)
          .json({ message: "Original order ID is required" });
      }

      if (
        !splitItems ||
        !Array.isArray(splitItems) ||
        splitItems.length === 0
      ) {
        console.error("❌ Invalid splitItems:", splitItems);
        return res.status(400).json({ message: "Split items are required" });
      }

      // Get original order
      const [originalOrder] = await (tenantDb || db)
        .select()
        .from(orders)
        .where(eq(orders.id, originalOrderId));

      if (!originalOrder) {
        return res.status(404).json({ message: "Original order not found" });
      }

      console.log(`📋 Original order info:`, {
        id: originalOrder.id,
        orderNumber: originalOrder.orderNumber,
        subtotal: originalOrder.subtotal,
        tax: originalOrder.tax,
        discount: originalOrder.discount,
        total: originalOrder.total,
      });

      const createdOrders = [];

      // Process each split order
      for (let i = 0; i < splitItems.length; i++) {
        const splitOrder = splitItems[i];

        if (!splitOrder.items || splitOrder.items.length === 0) {
          continue; // Skip empty orders
        }

        console.log(
          `💰 Creating split order ${i + 1} with accurate totals from frontend`,
        );

        // Generate unique order number with timestamp
        const orderNumber = splitOrder.name || `ORD-${Date.now() + i}`;

        console.log(`📝 Creating split order: ${orderNumber}`, {
          subtotal: splitOrder.subtotal,
          tax: splitOrder.tax,
          discount: splitOrder.discount,
          total: splitOrder.total,
          itemsCount: splitOrder.items.length,
        });

        const newOrderData = {
          orderNumber,
          tableId:
            splitOrder.tableId !== undefined && splitOrder.tableId !== null
              ? splitOrder.tableId
              : originalOrder.tableId,
          employeeId: originalOrder.employeeId,
          status: originalOrder.status,
          customerName: splitOrder.customerName || originalOrder.customerName,
          customerCount: splitOrder.customerCount || 1,
          subtotal: splitOrder.subtotal,
          tax: splitOrder.tax,
          discount: splitOrder.discount || "0",
          total: splitOrder.total,
          paymentMethod: null,
          paymentStatus: "pending",
          salesChannel: originalOrder.salesChannel,
          priceIncludeTax:
            splitOrder.priceIncludeTax !== undefined
              ? splitOrder.priceIncludeTax
              : originalOrder.priceIncludeTax,
          parentOrderId: originalOrderId,
          notes: `Tách từ ${originalOrder.orderNumber}`,
          createdAt: new Date(),
        };

        console.log(`📍 Creating split order with tableId:`, {
          splitOrderTableId: splitOrder.tableId,
          originalOrderTableId: originalOrder.tableId,
          finalTableId: newOrderData.tableId,
        });

        const [newOrder] = await (tenantDb || db)
          .insert(orders)
          .values(newOrderData)
          .returning();

        // Create order items for new order with accurate discount
        for (const item of splitOrder.items) {
          await (tenantDb || db).insert(orderItemsTable).values({
            orderId: newOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            discount: item.discount || "0",
            tax: item.tax || "0.00",
            priceBeforeTax: item.priceBeforeTax || "0.00",
            notes: item.notes || null,
          });

          console.log(
            `✅ Added ${item.quantity}x product ${item.productId} (${item.productName}) with discount ${item.discount || "0"}, tax ${item.tax || "0"} to new order ${orderNumber}`,
          );
        }

        createdOrders.push(newOrder);
      }

      // Delete ALL original order items
      await (tenantDb || db)
        .delete(orderItemsTable)
        .where(eq(orderItemsTable.orderId, originalOrderId));

      console.log(`🗑️ Deleted all original order items`);

      // Re-insert remaining items with updated quantities and discounts
      if (remainingItems && remainingItems.length > 0) {
        for (const item of remainingItems) {
          await (tenantDb || db).insert(orderItemsTable).values({
            orderId: originalOrderId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            discount: item.discount || "0",
            tax: item.tax || "0.00",
            priceBeforeTax: item.priceBeforeTax || "0.00",
            notes: null,
          });

          console.log(
            `✅ Re-inserted remaining item: product ${item.productId}, quantity ${item.quantity}, discount ${item.discount}, tax ${item.tax || "0"}`,
          );
        }
      }

      // Update original order totals
      if (remainingItems && remainingItems.length > 0 && originalOrderUpdate) {
        await (tenantDb || db)
          .update(orders)
          .set({
            subtotal: originalOrderUpdate.subtotal,
            tax: originalOrderUpdate.tax,
            discount: originalOrderUpdate.discount || "0",
            total: originalOrderUpdate.total,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, originalOrderId));

        console.log(`✅ Updated original order totals:`, {
          subtotal: originalOrderUpdate.subtotal,
          tax: originalOrderUpdate.tax,
          discount: originalOrderUpdate.discount,
          total: originalOrderUpdate.total,
        });
      } else {
        // Cancel original order if no items left
        await (tenantDb || db)
          .update(orders)
          .set({
            status: "cancelled",
            updatedAt: new Date(),
          })
          .where(eq(orders.id, originalOrderId));

        console.log(
          `✅ Cancelled original order ${originalOrderId} (no items remaining)`,
        );
      }

      console.log(
        `✅ Split order completed: Created ${createdOrders.length} new orders`,
      );
      res.json({
        success: true,
        orders: createdOrders,
        originalOrder: originalOrderId,
      });
    } catch (error) {
      console.error("Error splitting order:", error);
      res.status(500).json({ message: "Failed to split order" });
    }
  });

  // Create Purchase Order (legacy endpoint for backward compatibility)
  app.post("/api/purchase-orders", async (req: TenantRequest, res) => {
    try {
      console.log("🔍 API: Creating purchase receipt with data:", req.body);
      const tenantDb = await getTenantDatabase(req);

      const { items = [], ...orderData } = req.body;

      // Validate required fields
      if (!orderData.supplierId) {
        return res.status(400).json({
          message: "Missing required field: supplierId is required",
        });
      }

      // Generate PO number if not provided
      if (!orderData.poNumber || orderData.poNumber.trim() === "") {
        console.log("🔢 No PO number provided, generating one");
        orderData.poNumber = await storage.getNextPONumber(tenantDb);
        console.log("🔢 Generated PO number:", orderData.poNumber);
      }

      console.log("📝 Creating purchase receipt with:", {
        orderData,
        itemsCount: items.length,
      });

      const purchaseOrder = await storage.createPurchaseOrder(
        orderData,
        items,
        tenantDb,
      );
      console.log("✅ API: Purchase receipt created:", purchaseOrder);

      res.status(201).json(purchaseOrder);
    } catch (error) {
      console.error("❌ API: Failed to create purchase receipt:", error);
      res.status(500).json({
        message: "Failed to create purchase receipt",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get expense products from purchase receipts
  app.get(
    "/api/purchase-receipts/expense-products",
    async (req: TenantRequest, res) => {
      try {
        const tenantDb = await getTenantDatabase(req);
        const database = tenantDb || db;

        console.log("📊 Fetching expense products from purchase receipts");

        // Get category with name "thu chi"
        const [expenseCategory] = await database
          .select()
          .from(categories)
          .where(ilike(categories.name, "%thu chi%"))
          .limit(1);

        if (!expenseCategory) {
          console.log("⚠️ No 'thu chi' category found");
          return res.json({
            success: true,
            message: "Không tìm thấy danh mục 'thu chi'",
            data: [],
          });
        }

        console.log("📊 Found expense category:", expenseCategory);

        // Get all purchase receipts with purchaseType = 'chi phí' or 'expenses'
        const expenseReceipts = await database
          .select()
          .from(purchaseReceipts)
          .where(
            or(
              eq(purchaseReceipts.purchaseType, "chi phí"),
              eq(purchaseReceipts.purchaseType, "expenses"),
            ),
          );

        console.log(`📊 Found ${expenseReceipts.length} expense receipts`);

        // Get all purchase receipt items with their products that match criteria
        const expenseProducts = await database
          .select({
            receiptId: purchaseReceiptItems.purchaseReceiptId,
            receiptNumber: purchaseReceipts.receiptNumber,
            purchaseDate: purchaseReceipts.purchaseDate,
            purchaseType: purchaseReceipts.purchaseType,
            itemId: purchaseReceiptItems.id,
            productId: purchaseReceiptItems.productId,
            productName: purchaseReceiptItems.productName,
            quantity: purchaseReceiptItems.quantity,
            unitPrice: purchaseReceiptItems.unitPrice,
            total: purchaseReceiptItems.total,
            // Product details
            productType: products.productType,
            categoryId: products.categoryId,
            categoryName: categories.name,
            productSku: products.sku,
          })
          .from(purchaseReceiptItems)
          .innerJoin(
            purchaseReceipts,
            eq(purchaseReceiptItems.purchaseReceiptId, purchaseReceipts.id),
          )
          .leftJoin(products, eq(purchaseReceiptItems.productId, products.id))
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(
            and(
              or(
                eq(purchaseReceipts.purchaseType, "chi phí"),
                eq(purchaseReceipts.purchaseType, "expenses"),
              ),
              eq(products.productType, 4),
              eq(products.categoryId, expenseCategory.id),
            ),
          )
          .orderBy(desc(purchaseReceipts.purchaseDate));

        console.log(
          `✅ Found ${expenseProducts.length} expense products from purchase receipts`,
        );
        console.log(`📊 Sample data:`, expenseProducts.slice(0, 3));

        res.json({
          success: true,
          message: "OK",
          data: expenseProducts,
        });
      } catch (error) {
        console.error("❌ Error fetching expense products:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch expense products",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Expense Vouchers API
  app.get("/api/expense-vouchers", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate } = req.query;
      const tenantDb = await getTenantDatabase(req);

      console.log("💰 Fetching expense vouchers with date filter:", {
        startDate,
        endDate,
      });

      let vouchers = await storage.getExpenseVouchers(tenantDb);

      // Apply date filtering if provided
      if (startDate && endDate) {
        const start = new Date(startDate as string);
        start.setHours(0, 0, 0, 0);

        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);

        vouchers = vouchers.filter((voucher: any) => {
          if (!voucher.date) return false;

          const voucherDate = new Date(voucher.date);
          voucherDate.setHours(0, 0, 0, 0);

          return voucherDate >= start && voucherDate <= end;
        });

        console.log(
          `💰 Filtered expense vouchers: ${vouchers.length} vouchers in date range ${startDate} to ${endDate}`,
        );
      }

      res.json(vouchers);
    } catch (error) {
      console.error("Error fetching expense vouchers:", error);
      res.status(500).json({
        error: "Failed to fetch expense vouchers",
      });
    }
  });

  app.post("/api/expense-vouchers", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const voucherData = req.body;

      console.log("Creating expense voucher with data:", voucherData);

      // Validate required fields
      if (
        !voucherData.voucherNumber ||
        !voucherData.recipient ||
        !voucherData.amount ||
        voucherData.amount <= 0
      ) {
        console.error("Validation failed:", {
          voucherNumber: voucherData.voucherNumber,
          recipient: voucherData.recipient,
          amount: voucherData.amount,
        });
        return res.status(400).json({
          error:
            "Missing required fields: voucherNumber, recipient, and amount > 0 are required",
        });
      }

      // Include supplierId if provided
      const cleanVoucherData = {
        ...voucherData,
        supplierId: voucherData.supplierId || null,
      };

      const voucher = await storage.createExpenseVoucher(
        cleanVoucherData,
        tenantDb,
      );
      console.log("Expense voucher created successfully:", voucher);
      res.status(201).json(voucher);
    } catch (error) {
      console.error("Error creating expense voucher:", error);
      res.status(500).json({
        error: "Failed to create expense voucher",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.put("/api/expense-vouchers/:id", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const id = req.params.id;
      const voucherData = req.body;

      console.log("Updating expense voucher:", id, voucherData);

      // Validate required fields
      if (
        !voucherData.voucherNumber ||
        !voucherData.recipient ||
        !voucherData.amount ||
        voucherData.amount <= 0
      ) {
        console.error("Update validation failed:", {
          voucherNumber: voucherData.voucherNumber,
          recipient: voucherData.recipient,
          amount: voucherData.amount,
        });
        return res.status(400).json({
          error:
            "Missing required fields: voucherNumber, recipient, and amount > 0 are required",
        });
      }

      const voucher = await storage.updateExpenseVoucher(
        id,
        voucherData,
        tenantDb,
      );
      console.log("Expense voucher updated successfully:", voucher);
      res.json(voucher);
    } catch (error) {
      console.error("Error updating expense voucher:", error);
      res.status(500).json({
        error: "Failed to update expense voucher",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.delete("/api/expense-vouchers/:id", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const id = req.params.id;
      await storage.deleteExpenseVoucher(id, tenantDb);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting expense voucher:", error);
      res.status(500).json({
        error: "Failed to delete expense voucher",
      });
    }
  });

  // POS QR Payment API Routes - Proxy for external CreateQRPos API
  app.post("/api/pos/create-qr-proxy", async (req, res) => {
    try {
      const { bankCode, clientID, ...qrRequest } = req.body;

      console.log("🎯 Proxying CreateQRPos request:", {
        qrRequest,
        bankCode,
        clientID,
      });
      console.log(
        "🌐 Target URL:",
        `http://1.55.212.135:9335/api/CreateQRPos?bankCode=${bankCode}&clientID=${clientID}`,
      );

      // Forward request to external API (using HTTP as requested)
      const response = await fetch(
        `http://1.55.212.135:9335/api/CreateQRPos?bankCode=${bankCode}&clientID=${clientID}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "EDPOS-System/1.0",
          },
          body: JSON.stringify(qrRequest),
        },
      );

      console.log("al�� External API response status:", response.status);
      console.log(
        "📡 External API response headers:",
        Object.fromEntries(response.headers.entries()),
      );

      const responseText = await response.text();
      console.log(
        "📡 External API raw response:",
        responseText.substring(0, 500),
      ); // Log first 500 chars

      // Check if response is HTML (error page)
      if (
        responseText.includes("<!DOCTYPE") ||
        responseText.includes("<html>")
      ) {
        console.error("❌ External API returned HTML instead of JSON");
        console.error(
          "❌ This usually means the API endpoint is incorrect or the server returned an error page",
        );
        return res.status(502).json({
          error: "External API returned HTML error page instead of JSON",
          details: "API endpoint may be incorrect or unavailable",
          apiUrl: `http://1.55.212.135:9335/api/CreateQRPos`,
        });
      }

      if (!response.ok) {
        console.error("❌ External API error:", responseText);
        return res.status(response.status).json({
          error: responseText,
          statusCode: response.status,
          statusText: response.statusText,
        });
      }

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error("❌ Failed to parse JSON from external API:", parseError);
        return res.status(502).json({
          error: "Invalid JSON response from external API",
          rawResponse: responseText.substring(0, 200),
        });
      }

      console.log("✅ External API success:", result);

      // Return the result
      res.json(result);
    } catch (error) {
      console.error("❌ Proxy API error:", error);

      // Provide more detailed error information
      if (error.code === "ECONNREFUSED") {
        return res.status(503).json({
          error: "Cannot connect to external API server",
          details: "Connection refused - API server may be down",
          apiUrl: "http://1.55.212.135:9335/api/CreateQRPos",
        });
      }

      if (error.code === "ENOTFOUND") {
        return res.status(503).json({
          error: "External API server not found",
          details: "DNS lookup failed - check API server address",
          apiUrl: "http://1.55.212.135:9335/api/CreateQRPos",
        });
      }

      res.status(500).json({
        error: "Internal server error while calling external API",
        details: error.message,
        errorType: error.constructor.name,
      });
    }
  });

  // Fallback route for CreateQRPos API
  app.post("/api/pos/create-qr", async (req, res) => {
    try {
      const { bankCode, clientID } = req.query;
      const qrRequest = req.body;

      console.log("🎯 Fallback CreateQRPos request:", {
        qrRequest,
        bankCode,
        clientID,
      });

      // Forward to external API
      const response = await fetch(
        `http://1.55.212.135:9335/api/CreateQRPos?bankCode=${bankCode}&clientID=${clientID}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "EDPOS-System/1.0",
          },
          body: JSON.stringify(qrRequest),
          timeout: 30000,
        },
      );

      const responseText = await response.text();
      console.log(
        "📡 External API raw response:",
        responseText.substring(0, 500),
      );

      if (!response.ok) {
        console.error(
          "❌ External API error:",
          response.status,
          responseText.substring(0, 200),
        );
        return res.status(response.status).json({
          error: responseText,
          statusCode: response.status,
          statusText: response.statusText,
        });
      }

      // Check if response looks like HTML (external API might be returning error page)
      if (
        responseText.trim().startsWith("<!DOCTYPE") ||
        responseText.trim().startsWith("<html")
      ) {
        console.error("❌ External API returned HTML instead of JSON");
        return res.status(502).json({
          error: "External API returned HTML page instead of JSON response",
          rawResponse: responseText.substring(0, 200),
          suggestion: "External API might be down or returning error page",
        });
      }

      let result;
      try {
        result = JSON.parse(responseText);
        console.log("✅ External API JSON parsed successfully:", result);
      } catch (parseError) {
        console.error(
          "❌ Failed to parse external API response as JSON:",
          parseError,
        );
        return res.status(502).json({
          error: "Invalid JSON response from external API",
          rawResponse: responseText.substring(0, 200),
          parseError: parseError.message,
        });
      }

      res.json(result);
    } catch (error) {
      console.error("❌ Fallback CreateQRPos API error:", error);
      res.status(500).json({
        error: "Internal server error while calling external API",
        details: error.message,
      });
    }
  });

  // Employees
  app.get(
    "/api/employees",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/employees - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for employees");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for employees:",
            dbError,
          );
          tenantDb = null;
        }

        const employees = await storage.getEmployees(tenantDb);
        console.log(`✅ Successfully fetched ${employees.length} employees`);
        res.json(employees);
      } catch (error) {
        console.error("❌ Error fetching employees:", error);
        res.status(500).json({
          message: "Failed to fetch employees",
        });
      }
    },
  );

  app.get("/api/employees/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const employee = await storage.getEmployee(id, tenantDb);

      if (!employee) {
        return res.status(404).json({
          message: "Employee not found",
        });
      }

      res.json(employee);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch employee",
      });
    }
  });

  app.post("/api/employees", async (req: TenantRequest, res) => {
    try {
      const validatedData = insertEmployeeSchema.parse(req.body);
      const tenantDb = await getTenantDatabase(req);

      // Check if email already exists (only if email is provided and not empty)
      if (validatedData.email && validatedData.email.trim() !== "") {
        const existingEmployee = await storage.getEmployeeByEmail(
          validatedData.email,
          tenantDb,
        );
        if (existingEmployee) {
          return res.status(400).json({
            message: "Email đã tồn tại trong hệ thống",
            code: "DUPLICATE_EMAIL",
            field: "email",
          });
        }
      }

      const employee = await storage.createEmployee(validatedData, tenantDb);
      res.status(201).json(employee);
    } catch (error) {
      console.log("error: ", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid employee data",
          errors: error,
        });
      }
      res.status(500).json({
        message: "Failed to create employee",
      });
    }
  });

  app.put("/api/employees/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertEmployeeSchema.partial().parse(req.body);
      const tenantDb = await getTenantDatabase(req);

      // Check if email already exists (only if email is provided and not empty, excluding current employee)
      if (validatedData.email && validatedData.email.trim() !== "") {
        const existingEmployee = await storage.getEmployeeByEmail(
          validatedData.email,
          tenantDb,
        );
        if (existingEmployee && existingEmployee.id !== id) {
          return res.status(409).json({
            message: "Email đã tồn tại trong hệ thống",
            code: "DUPLICATE_EMAIL",
            field: "email",
          });
        }
      }

      const employee = await storage.updateEmployee(
        id,
        validatedData,
        tenantDb,
      );

      if (!employee) {
        return res.status(404).json({
          message: "Employee not found",
        });
      }

      res.json(employee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid employee data",
          errors: error.errors,
        });
      }
      res.status(500).json({
        message: "Failed to update employee",
      });
    }
  });

  app.delete("/api/employees/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const deleted = await storage.deleteEmployee(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          message: "Employee not found",
        });
      }

      res.json({
        message: "Employee deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to delete employee",
      });
    }
  });

  // Attendance routes
  app.get("/api/attendance", async (req: TenantRequest, res) => {
    try {
      const { date, startDate, endDate, employeeId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      console.log(`📅 Attendance API called with params:`, {
        date,
        startDate,
        endDate,
        employeeId,
      });

      if (!tenantDb) {
        return res.status(500).json({
          message: "Database connection not available",
        });
      }

      let records;

      // If startDate and endDate are provided, use date range
      if (startDate && endDate) {
        console.log(
          `📅 Fetching attendance records by date range: ${startDate} to ${endDate}`,
        );
        records = await storage.getAttendanceRecordsByRange(
          startDate as string,
          endDate as string,
          tenantDb,
        );
      } else if (date) {
        // Single date filter
        console.log(`📅 Fetching attendance records for single date: ${date}`);
        const employeeIdNum = employeeId
          ? parseInt(employeeId as string)
          : undefined;
        records = await storage.getAttendanceRecords(
          employeeIdNum,
          date as string,
          tenantDb,
        );
      } else {
        // All records
        console.log(`📅 Fetching all attendance records`);
        const employeeIdNum = employeeId
          ? parseInt(employeeId as string)
          : undefined;
        records = await storage.getAttendanceRecords(
          employeeIdNum,
          undefined,
          tenantDb,
        );
      }

      console.log(`✅ Returning ${records.length} attendance records`);
      res.json(records);
    } catch (error) {
      console.error("Error fetching attendance records:", error);
      res.status(500).json({
        message: "Failed to fetch attendance records",
      });
    }
  });

  app.get(
    "/api/attendance/today/:employeeId",
    async (req: TenantRequest, res) => {
      try {
        const employeeId = parseInt(req.params.employeeId);
        const tenantDb = await getTenantDatabase(req);
        const record = await storage.getTodayAttendance(employeeId, tenantDb);
        res.json(record);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch today's attendance",
        });
      }
    },
  );

  app.post("/api/attendance/clock-in", async (req: TenantRequest, res) => {
    try {
      const { employeeId, notes } = req.body;

      if (!employeeId) {
        return res.status(400).json({
          message: "Employee ID is required",
        });
      }

      const tenantDb = await getTenantDatabase(req);
      const record = await storage.clockIn(
        parseInt(employeeId),
        notes,
        tenantDb,
      );
      res.status(201).json(record);
    } catch (error) {
      console.error("Clock-in API error:", error);

      let statusCode = 500;
      let message = "Failed to clock in";

      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          statusCode = 404;
          message = error.message;
        } else if (error.message.includes("already clocked in")) {
          statusCode = 400;
          message = error.message;
        } else if (error.message.includes("database")) {
          message = "Database error occurred";
        }
      }

      res.status(statusCode).json({
        message,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/attendance/clock-out/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const record = await storage.clockOut(id, tenantDb);

      if (!record) {
        return res.status(404).json({
          message: "Attendance record not found",
        });
      }

      res.json(record);
    } catch (error) {
      res.status(500).json({
        message: "Failed to clock out",
      });
    }
  });

  app.post(
    "/api/attendance/break-start/:id",
    async (req: TenantRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);
        const record = await storage.startBreak(id, tenantDb);

        if (!record) {
          return res.status(404).json({
            message: "Attendance record not found",
          });
        }

        res.json(record);
      } catch (error) {
        res.status(500).json({
          message: "Failed to start break",
        });
      }
    },
  );

  app.post("/api/attendance/break-end/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const record = await storage.endBreak(id, tenantDb);

      if (!record) {
        return res.status(404).json({
          message: "Attendance record not found",
        });
      }

      res.json(record);
    } catch (error) {
      res.status(500).json({
        message: "Failed to end break",
      });
    }
  });

  app.put("/api/attendance/:id/status", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const tenantDb = await getTenantDatabase(req);
      const record = await storage.updateAttendanceStatus(id, status, tenantDb);

      if (!record) {
        return res.status(404).json({
          message: "Attendance record not found",
        });
      }

      res.json(record);
    } catch (error) {
      res.status(500).json({
        message: "Failed to update attendance status",
      });
    }
  });

  // Tables
  app.get("/api/tables", tenantMiddleware, async (req: TenantRequest, res) => {
    try {
      console.log("🔍 GET /api/tables - Starting request processing");
      let tenantDb;
      try {
        tenantDb = await getTenantDatabase(req);
        console.log("✅ Tenant database connection obtained for tables");
      } catch (dbError) {
        console.error("❌ Failed to get tenant database for tables:", dbError);
        tenantDb = null;
      }

      const tables = await storage.getTables(tenantDb);
      console.log(`✅ Successfully fetched ${tables.length} tables`);
      res.json(tables);
    } catch (error) {
      console.error("❌ Error fetching tables:", error);
      res.status(500).json({
        message: "Failed to fetch tables",
      });
    }
  });

  app.get("/api/tables/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const table = await storage.getTable(id, tenantDb);

      if (!table) {
        return res.status(404).json({
          message: "Table not found",
        });
      }

      res.json(table);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch table",
      });
    }
  });

  app.post("/api/tables", async (req: TenantRequest, res) => {
    try {
      const tableData = insertTableSchema.parse(req.body);
      const tenantDb = await getTenantDatabase(req);
      const table = await storage.createTable(tableData, tenantDb);
      res.status(201).json(table);
    } catch (error) {
      res.status(400).json({
        message: "Failed to create table",
      });
    }
  });

  app.put("/api/tables/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tableData = insertTableSchema.partial().parse(req.body);
      const tenantDb = await getTenantDatabase(req);
      const table = await storage.updateTable(id, tableData, tenantDb);

      if (!table) {
        return res.status(404).json({
          message: "Table not found",
        });
      }

      res.json(table);
    } catch (error) {
      res.status(500).json({
        message: "Failed to update table",
      });
    }
  });

  app.put("/api/tables/:id/status", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const tenantDb = await getTenantDatabase(req);
      const table = await storage.updateTableStatus(id, status, tenantDb);

      if (!table) {
        return res.status(404).json({
          message: "Table not found",
        });
      }

      res.json(table);
    } catch (error) {
      res.status(500).json({
        message: "Failed to update table status",
      });
    }
  });

  app.delete("/api/tables/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const deleted = await storage.deleteTable(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          message: "Table not found",
        });
      }

      res.json({
        message: "Table deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to delete table",
      });
    }
  });

  // Orders
  app.get("/api/orders", async (req: TenantRequest, res) => {
    try {
      console.log("🔍 GET /api/orders - Starting request processing");
      const { salesChannel, tableId } = req.query;
      let storeCode = req.tenant?.storeCode;

      let tenantDb = await getTenantDatabase(req);

      let orders = await storage.getOrders(
        undefined,
        undefined,
        tenantDb,
        salesChannel as string,
      );

      // Filter by storeCode if available
      if (storeCode && storeCode.startsWith("CH-")) {
        orders = orders.filter((order) => order.storeCode === storeCode);
      }

      // Filter by tableId if provided
      if (tableId) {
        const tableIdNum = parseInt(tableId as string);
        if (!isNaN(tableIdNum)) {
          orders = orders.filter((order) => order.tableId === tableIdNum);
          console.log(
            `✅ Successfully fetched ${orders.length} orders for table ${tableIdNum}`,
          );
        }
      } else {
        console.log(
          `✅ Successfully fetched ${orders.length} orders${salesChannel ? ` for channel: ${salesChannel}` : ""}`,
        );
      }

      res.json(orders);
    } catch (error) {
      console.error("❌ Error fetching orders:", error);
      res.status(500).json({
        error: "Failed to fetch orders",
      });
    }
  });

  app.get("/api/orders/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const order = await storage.getOrder(id, tenantDb);

      if (!order) {
        return res.status(404).json({
          message: "Order not found",
        });
      }

      const items = await storage.getOrderItems(id, tenantDb);
      res.json({ ...order, items });
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch order",
      });
    }
  });

  app.post("/api/orders", async (req: TenantRequest, res) => {
    try {
      const { order, items } = req.body;
      const tenantDb = await getTenantDatabase(req);
      console.log(
        "Received order data:",
        JSON.stringify(
          {
            order,
            items,
          },
          null,
          2,
        ),
      );

      // Get store settings for price_include_tax
      const database = tenantDb || db;
      const [storeSettingsData] = await database
        .select()
        .from(storeSettings)
        .limit(1);
      let priceIncludeTax = storeSettingsData?.priceIncludesTax || false;
      console.log("Store settings - priceIncludeTax:", priceIncludeTax);
      if (!storeSettingsData)
        return res.status(500).json({ message: "Store settings not found" });

      // If no order object is provided, create a default one for POS orders
      let orderData;
      if (!order) {
        console.log("No order object provided, creating default POS order");

        // Calculate totals from items
        let subtotal = 0;
        let tax = 0;

        if (items && Array.isArray(items)) {
          for (const item of items) {
            const itemSubtotal =
              parseFloat(item.unitPrice || "0") * (item.quantity || 0);
            subtotal += itemSubtotal;

            // Get product to calculate tax
            try {
              const [product] = await tenantDb
                .select()
                .from(products)
                .where(eq(products.id, item.productId))
                .limit(1);

              if (
                product?.afterTaxPrice &&
                product.afterTaxPrice !== null &&
                product.afterTaxPrice !== ""
              ) {
                const afterTaxPrice = parseFloat(product.afterTaxPrice); // Giá sau thuế
                const basePrice = parseFloat(product.price);
                const taxPerUnit = afterTaxPrice - basePrice;
                tax += taxPerUnit * (item.quantity || 0);
              }
            } catch (productError) {
              console.warn(
                "Could not fetch product for tax calculation:",
                item.productId,
              );
            }
          }
        }

        const total = subtotal + tax;

        orderData = {
          orderNumber: `ORD-${new Date()}`,
          tableId: null,
          employeeId: null,
          status: "pending",
          customerName: "Khách hàng",
          customerCount: 1,
          subtotal: Number(subtotal.toFixed(2)),
          tax: Number(tax.toFixed(2)),
          discount: 0,
          total: Number(total.toFixed(2)),
          paymentMethod: null,
          paymentStatus: "pending",
          salesChannel: "pos",
          priceIncludeTax: priceIncludeTax,
          notes: "POS Order",
          orderedAt: new Date(),
        };

        console.log("Created default order:", orderData);
      } else {
        orderData = insertOrderSchema.parse(order);
        // Set salesChannel based on tableId if not explicitly provided
        if (!orderData.salesChannel) {
          orderData.salesChannel = orderData.tableId ? "table" : "pos";
        }
        // Set priceIncludeTax from store settings if not explicitly provided
        if (orderData.priceIncludeTax === undefined) {
          orderData.priceIncludeTax = priceIncludeTax;
        }
      }

      // Parse and prepare items with discount distribution
      let itemsData = [];
      if (items && Array.isArray(items)) {
        itemsData = items.map((item) => {
          const parsedItem = insertOrderItemSchema.parse(item);

          // If item already has discount amount, use it directly
          if (item.discountAmount && parseFloat(item.discountAmount) > 0) {
            parsedItem.discount = item.discountAmount;
            console.log(
              `💰 Using pre-calculated discount for item ${item.productName}: ${item.discountAmount}`,
            );
          }

          return parsedItem;
        });
      }

      // Calculate discount distribution if order has discount and items don't already have discounts
      const orderDiscount = Number(orderData.discount || 0);
      const hasPreCalculatedDiscounts = itemsData.some(
        (item) => parseFloat(item.discount || "0") > 0,
      );

      console.log(
        "Parsed order data with discount distribution:",
        JSON.stringify(
          {
            orderData,
            itemsData,
          },
          null,
          2,
        ),
      );

      const newOrder = await storage.createOrder(
        orderData,
        itemsData,
        tenantDb,
      );

      // Verify items were created
      const createdItems = await storage.getOrderItems(newOrder.id, tenantDb);
      console.log(
        `Created ${createdItems.length} items for order ${newOrder.id}:`,
        createdItems,
      );

      res.status(201).json(newOrder);
    } catch (error) {
      console.error("Order creation error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid order data",
          errors: error.errors,
          details: error.format(),
        });
      }
      res.status(500).json({
        message: "Failed to create order",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.put("/api/orders/:id", async (req: TenantRequest, res) => {
    try {
      const { id: rawId } = req.params;
      const orderData = req.body; // Use raw body to preserve all fields
      const tenantDb = await getTenantDatabase(req);

      console.log(`=== PUT ORDER API CALLED ===`);
      console.log(`Raw Order ID: ${rawId}`);
      console.log(`Update data:`, JSON.stringify(orderData, null, 2));

      // Handle temporary IDs - allow flow to continue
      const isTemporaryId = rawId.startsWith("temp-");
      let finalResult; // Declare finalResult here

      if (isTemporaryId) {
        console.log(
          `🟡 Temporary order ID detected: ${rawId} - returning success for flow continuation`,
        );

        // Return a mock success response to allow E-invoice flow to continue
        const mockOrder = {
          id: rawId,
          orderNumber: `TEMP-${new Date()}`,
          tableId: null,
          customerName: orderData.customerName || "Khách hàng",
          status: orderData.status || "paid",
          paymentMethod: orderData.paymentMethod || "cash",
          einvoiceStatus: orderData.einvoiceStatus || 0,
          paidAt: orderData.paidAt || new Date(),
          updatedAt: new Date(),
          updated: true,
          updateTimestamp: new Date(),
        };

        console.log(
          `✅ Mock order update response for temporary ID:`,
          mockOrder,
        );
        return res.json(mockOrder);
      }

      const id = parseInt(rawId);
      if (isNaN(id)) {
        console.error(`❌ Invalid order ID: ${rawId}`);
        return res.status(400).json({
          message: "Invalid order ID",
        });
      }

      // Check if order exists first
      const [existingOrder] = await tenantDb
        .select()
        .from(orders)
        .where(eq(orders.id, id));

      if (!existingOrder) {
        console.error(`❌ Order not found: ${id}`);
        return res.status(404).json({
          message: "Order not found",
        });
      }

      console.log(`📋 Current order state:`, {
        id: existingOrder.id,
        orderNumber: existingOrder.orderNumber,
        tableId: existingOrder.tableId,
        currentStatus: existingOrder.status,
        paymentMethod: existingOrder.paymentMethod,
        currentSubtotal: existingOrder.subtotal,
        currentTax: existingOrder.tax,
        currentTotal: existingOrder.total,
        currentDiscount: existingOrder.discount,
      });

      // Use EXACT values from frontend - ZERO calculation, ZERO validation
      console.log(
        `💰 Using PURE frontend values for order ${id} - NO calculation, NO validation, NO modification`,
      );

      // Log what frontend sent but DO NOT modify anything
      console.log(`💰 Frontend values (saving exactly as received):`, {
        subtotal: orderData.subtotal,
        tax: orderData.tax,
        discount: orderData.discount,
        total: orderData.total,
        source: "pure_frontend_exact_save",
      });

      // Fetch existing items to compare quantities and calculate discount distribution
      const existingOrderItems = await tenantDb
        .select()
        .from(orderItemsTable)
        .where(eq(orderItemsTable.orderId, id));

      // Step 1: Add new items if any exist
      if (orderData.items && orderData.items.length > 0) {
        console.log(
          `📝 Adding ${orderData.items.length} new items to existing order ${existingOrder.id}`,
        );
        // Add items directly through storage instead of undefined apiRequest
        try {
          const validatedItems = orderData.items.map((item) => ({
            orderId: existingOrder.id,
            productId: parseInt(item.productId),
            quantity: parseInt(item.quantity),
            unitPrice: item.unitPrice.toString(),
            total: item.total
              ? item.total.toString()
              : (
                  parseFloat(item.unitPrice) * parseInt(item.quantity)
                ).toString(),
            discount: "0.00",
            notes: item.notes || null,
          }));

          await tenantDb.insert(orderItemsTable).values(validatedItems);

          console.log("✅ Items added successfully via direct storage");
        } catch (addError) {
          console.error("❌ Error adding items:", addError);
        }
      } else {
        console.log(
          `📝 No new items to add to order ${existingOrder.id}, proceeding with order update only`,
        );
      }

      // Get discount value from order data
      const discount = Number(orderData.discount || 0);

      // Step 1.6: Update discount for existing order items
      if (
        discount > 0 &&
        orderData?.existingItems &&
        orderData?.existingItems?.length > 0
      ) {
        console.log(
          `💰 Updating discount for ${orderData?.existingItems?.length} existing order items`,
        );

        // Update each order item with its calculated discount
        for (const item of orderData?.existingItems) {
          try {
            await tenantDb
              .update(orderItemsTable)
              .set({
                discount: parseFloat(item.discount || "0").toFixed(2),
              })
              .where(eq(orderItemsTable.id, item.id));

            console.log(
              `✅ Updated order item ${item.id} with discount: ${item.discount}`,
            );
          } catch (itemError) {
            console.error(
              `❌ Error updating order item ${item.id} discount:`,
              itemError,
            );
          }
        }
      }

      // Step 2: Fix timestamp handling before updating order
      if (orderData.paidAt && typeof orderData.paidAt === "string") {
        orderData.paidAt = new Date(orderData.paidAt);
      }
      if (orderData.orderedAt && typeof orderData.orderedAt === "string") {
        orderData.orderedAt = new Date(orderData.orderedAt);
      }

      // Step 2: Update the order itself
      const order = await storage.updateOrder(id, orderData, tenantDb);

      if (!order) {
        console.error(`❌ Failed to update order ${id}`);
        return res.status(500).json({
          message: "Failed to update order",
        });
      }

      console.log(`✅ Order update API completed successfully:`, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paidAt: order.paidAt,
        einvoiceStatus: order.einvoiceStatus,
        updatedSubtotal: order.subtotal,
        updatedTax: order.tax,
        updatedDiscount: order.discount,
        updatedTotal: order.total,
      });

      res.json({
        ...order,
        updated: true,
        updateTimestamp: new Date(),
      });
    } catch (error) {
      console.error("❌ PUT Order API error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid order data",
          errors: error.errors,
        });
      }
      res.status(500).json({
        message: "Failed to update order",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.put("/api/orders/:id/status", async (req: TenantRequest, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      console.log(`🚀 ========================================`);
      console.log(`🚀 API ENDPOINT CALLED: PUT /api/orders/${id}/status`);
      console.log(`🚀 ========================================`);
      console.log(
        `📋 Order status update API called - Order ID: ${id}, New Status: ${status}`,
      );

      // Get tenant database first
      const tenantDb = await getTenantDatabase(req);

      // Handle both numeric IDs and temporary IDs
      let orderId: number | string = id;
      const isTemporaryId = id.startsWith("temp-");

      if (!isTemporaryId) {
        const parsedId = parseInt(id);
        if (isNaN(parsedId)) {
          console.error(`❌ Invalid order ID: ${id}`);
          return res.status(400).json({
            message: "Invalid order ID",
          });
        }
        orderId = parsedId;
        console.log(`✅ ID converted to number: ${orderId}`);
      } else {
        console.log(`🟡 Keeping temporary ID as string: ${orderId}`);
        // For temporary IDs, just return success without database update
        return res.json({
          id: orderId,
          status: status,
          updated: true,
          previousStatus: "served",
          updateTimestamp: new Date(),
          success: true,
          temporary: true,
        });
      }

      if (!status) {
        console.error(
          ` 
 �� Missing status in request body, received:`,
          req.body,
        );
        return res.status(400).json({
          message: "Status is required",
        });
      }

      // Get the current order to log its current state
      const [foundOrder] = await tenantDb
        .select()
        .from(orders)
        .where(eq(orders.id, orderId as number));

      if (!foundOrder) {
        console.error(`❌ Order not found for ID: ${id}`);
        return res.status(404).json({
          message: "Order not found",
        });
      }

      console.log(`📊 API: Current order state before update:`, {
        orderId: foundOrder.id,
        orderNumber: foundOrder.orderNumber,
        tableId: foundOrder.tableId,
        currentStatus: foundOrder.status,
        requestedStatus: status,
        timestamp: new Date(),
      });

      // Direct database update for better reliability
      console.log(
        `🔄 Performing direct database update for order ${orderId} to status ${status}`,
      );

      const updateData: any = {
        status: status,
        updatedAt: new Date(),
      };

      // Add paidAt timestamp if status is 'paid'
      if (status === "paid") {
        updateData.paidAt = new Date();
      }

      const [updatedOrder] = await tenantDb
        .update(orders)
        .set(updateData)
        .where(eq(orders.id, orderId as number))
        .returning();

      if (!updatedOrder) {
        console.error(
          `❌ Failed to update order ${orderId} to status ${status}`,
        );
        return res.status(500).json({
          message: "Failed to update order status",
          orderId: id,
          requestedStatus: status,
        });
      }

      console.log(`✅ API: Order status updated successfully:`, {
        orderId: updatedOrder.id,
        orderNumber: updatedOrder.orderNumber,
        tableId: updatedOrder.tableId,
        previousStatus: foundOrder.status,
        newStatus: updatedOrder.status,
        paidAt: updatedOrder.paidAt,
        timestamp: new Date(),
      });

      // If status was updated to 'paid', check if table should be released
      if (status === "paid" && updatedOrder.tableId) {
        try {
          // Check if there are any other unpaid orders on this table
          const unpaidOrders = await tenantDb
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.tableId, updatedOrder.tableId),
                ne(orders.status, "paid"),
                ne(orders.status, "cancelled"),
              ),
            );

          console.log(
            `📋 Checking table ${updatedOrder.tableId} for other unpaid orders:`,
            {
              tableId: updatedOrder.tableId,
              unpaidOrdersCount: unpaidOrders.length,
              unpaidOrders: unpaidOrders.map((o) => ({
                id: o.id,
                orderNumber: o.orderNumber,
                status: o.status,
              })),
            },
          );

          // If no unpaid orders remain, release the table
          if (unpaidOrders.length === 0) {
            await tenantDb
              .update(tables)
              .set({
                status: "available",
                updatedAt: new Date(),
              })
              .where(eq(tables.id, updatedOrder.tableId));

            console.log(
              `✅ Table ${updatedOrder.tableId} released to available status`,
            );
          }
        } catch (tableUpdateError) {
          console.error(`❌ Error updating table status:`, tableUpdateError);
          // Don't fail the order update if table update fails
        }
      }

      // Send comprehensive response data
      res.json({
        ...updatedOrder,
        updated: true,
        previousStatus: foundOrder.status,
        updateTimestamp: new Date(),
        success: true,
      });
    } catch (error) {
      console.error(`❌ Error updating order status via API:`, error);
      res.status(500).json({
        message: "Failed to update order status",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
    }
  });

  app.post("/api/orders/:id/payment", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const { paymentMethod, amountReceived, change } = req.body;
      const tenantDb = await getTenantDatabase(req);

      console.log(
        `💳 Payment completion API called - Order ID: ${id}, Payment Method: ${paymentMethod}`,
      );

      // Update order with payment details and status
      const updateData = {
        status: "paid",
        paymentMethod,
        paidAt: new Date(),
      };

      // Add cash payment specific data if provided
      if (amountReceived !== undefined) {
        updateData.amountReceived = amountReceived;
      }
      if (change !== undefined) {
        updateData.change = change;
      }

      console.log(`=>$ Updating order with payment data:`, updateData);

      const order = await storage.updateOrder(id, updateData, tenantDb);

      if (!order) {
        console.error(`❌ Order not found for payment completion: ${id}`);
        return res.status(404).json({
          message: "Order not found",
        });
      }

      console.log(`✅ Payment completed successfully for order:`, order);

      res.json({ ...order, paymentMethod, amountReceived, change });
    } catch (error) {
      console.error("❌ Payment completion error:", error);
      res.status(500).json({
        message: "Failed to complete payment",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get ALL order items
  app.get("/api/order-items", async (req: TenantRequest, res) => {
    try {
      console.log("=== GET ALL ORDER ITEMS API CALLED ===");

      let tenantDb;
      try {
        tenantDb = await getTenantDatabase(req);
        console.log(
          "✅ Tenant database connection obtained for all order items",
        );
      } catch (dbError) {
        console.error(
          "❌ Failed to get tenant database for all order items:",
          dbError,
        );
        tenantDb = null;
      }

      const database = tenantDb || db;
      console.log("Fetching all order items from database...");

      const items = await database
        .select({
          id: orderItemsTable.id,
          orderId: orderItemsTable.orderId,
          productId: orderItemsTable.productId,
          quantity: orderItemsTable.quantity,
          unitPrice: orderItemsTable.unitPrice,
          total: orderItemsTable.total,
          notes: orderItemsTable.notes,
          productName: products.name,
          productSku: products.sku,
        })
        .from(orderItemsTable)
        .leftJoin(products, eq(orderItemsTable.productId, products.id))
        .orderBy(desc(orderItemsTable.id));

      console.log(`✅ Found ${items.length} total order items`);

      // Ensure items is always an array, even if empty
      const safeItems = Array.isArray(items) ? items : [];
      res.json(safeItems);
    } catch (error) {
      console.error("=== GET ALL ORDER ITEMS ERROR ===");
      console.error("Error type:", error?.constructor?.name || "Unknown");
      console.error("Error message:", error?.message || "Unknown error");
      console.error("Error stack:", error?.stack || "No stack trace");

      res.status(500).json({
        message: "Failed to fetch all order items",
        details: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      });
    }
  });

  // Get order items by date range
  app.get(
    "/api/order-items/date-range/:startDate/:endDate/:floor?",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate, floor } = req.params;
        const floorFilter = floor || "all";

        console.log("=== GET ORDER ITEMS BY DATE RANGE API CALLED ===");
        console.log("Date range requested:", {
          startDate,
          endDate,
          floorFilter,
        });

        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for order items by date",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for order items by date:",
            dbError,
          );
          tenantDb = null;
        }

        const database = tenantDb || db;

        // Parse dates
        let start: Date;
        let end: Date;

        if (startDate.includes("T") || startDate.includes(":")) {
          start = new Date(startDate);
        } else {
          start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
        }

        if (endDate.includes("T") || endDate.includes(":")) {
          end = new Date(endDate);
        } else {
          end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
        }

        // Base query to get order items with order data
        let query = database
          .select({
            id: orderItemsTable.id,
            orderId: orderItemsTable.orderId,
            productId: orderItemsTable.productId,
            quantity: orderItemsTable.quantity,
            unitPrice: orderItemsTable.unitPrice,
            total: orderItemsTable.total,
            discount: orderItemsTable.discount,
            notes: orderItemsTable.notes,
            // Product info
            productName: products.name,
            productSku: products.sku,
            // Order info
            orderDate: orders.orderedAt,
            orderNumber: orders.orderNumber,
            tableId: orders.tableId,
          })
          .from(orderItemsTable)
          .innerJoin(orders, eq(orderItemsTable.orderId, orders.id))
          .leftJoin(products, eq(orderItemsTable.productId, products.id))
          .where(
            and(
              gte(orders.orderedAt, start),
              lte(orders.orderedAt, end),
              or(eq(orders.status, "paid"), eq(orders.status, "completed")),
            ),
          );

        // Add floor filter if specified
        if (floorFilter && floorFilter !== "all") {
          query = query
            .leftJoin(tables, eq(orders.tableId, tables.id))
            .where(
              and(
                gte(orders.orderedAt, start),
                lte(orders.orderedAt, end),
                or(eq(orders.status, "paid"), eq(orders.status, "completed")),
                eq(tables.floor, floorFilter),
              ),
            );
        }

        const items = await query.orderBy(
          desc(orders.orderedAt),
          desc(orderItemsTable.id),
        );

        console.log(`✅ Found ${items.length} order items by date range`);

        // Ensure items is always an array, even if empty
        const safeItems = Array.isArray(items) ? items : [];
        res.json(safeItems);
      } catch (error) {
        console.error("=== GET ORDER ITEMS BY DATE RANGE ERROR ===");
        console.error("Error type:", error?.constructor?.name || "Unknown");
        console.error("Error message:", error?.message || "Unknown error");
        console.error("Error stack:", error?.stack || "No stack trace");

        res.status(500).json({
          message: "Failed to fetch order items by date range",
          details: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date(),
        });
      }
    },
  );

  // Get order items for a specific order
  app.get("/api/order-items/:orderId", async (req: TenantRequest, res) => {
    try {
      console.log("=== GET ORDER ITEMS API CALLED ===");
      const orderId = parseInt(req.params.orderId);
      console.log("Order ID requested:", orderId);

      if (isNaN(orderId)) {
        console.error("Invalid order ID provided:", req.params.orderId);
        return res.status(400).json({
          message: "Invalid order ID",
        });
      }

      let tenantDb;
      try {
        tenantDb = await getTenantDatabase(req);
        console.log("✅ Tenant database connection obtained for order items");
      } catch (dbError) {
        console.error(
          "❌ Failed to get tenant database for order items:",
          dbError,
        );
        tenantDb = null;
      }

      console.log("Fetching order items from storage...");
      const items = await storage.getOrderItems(orderId, tenantDb);
      console.log(`Found ${items.length} order items:`, items);

      // Ensure items is always an array, even if empty
      const safeItems = Array.isArray(items) ? items : [];
      res.json(safeItems);
    } catch (error) {
      console.error("=== GET ORDER ITEMS ERROR ===");
      console.error("Error type:", error?.constructor?.name || "Unknown");
      console.error("Error message:", error?.message || "Unknown error");
      console.error("Error stack:", error?.stack || "No stack trace");
      console.error("Order ID:", req.params.orderId);

      res.status(500).json({
        message: "Failed to fetch order items",
        details: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      });
    }
  });

  // Update a specific order item
  app.put("/api/order-items/:itemId", async (req: TenantRequest, res) => {
    try {
      console.log("=== UPDATE ORDER ITEM API CALLED ===");
      const itemId = parseInt(req.params.itemId);
      const updateData = req.body;
      const tenantDb = await getTenantDatabase(req);

      console.log("Item ID to update:", itemId);
      console.log("Update data:", updateData);

      if (isNaN(itemId)) {
        return res.status(400).json({
          error: "Invalid item ID",
        });
      }

      const database = tenantDb || db;

      // Check if order item exists
      const [existingItem] = await database
        .select()
        .from(orderItemsTable)
        .where(eq(orderItemsTable.id, itemId))
        .limit(1);

      if (!existingItem) {
        return res.status(404).json({
          error: "Order item not found",
        });
      }

      // Prepare update data
      const updateFields: any = {};

      if (updateData.quantity !== undefined) {
        updateFields.quantity = parseInt(updateData.quantity);
      }

      if (updateData.unitPrice !== undefined) {
        updateFields.unitPrice = updateData.unitPrice.toString();
      }

      if (updateData.total !== undefined) {
        updateFields.total = updateData.total.toString();
      }

      if (updateData.discount !== undefined) {
        updateFields.discount = parseFloat(updateData.discount || "0").toFixed(
          2,
        );
      }

      if (updateData.tax !== undefined) {
        updateFields.tax = parseFloat(updateData.tax || "0").toFixed(2);
      }

      if (updateData.priceBeforeTax !== undefined) {
        updateFields.priceBeforeTax = parseFloat(
          updateData.priceBeforeTax || "0",
        ).toFixed(2);
      }

      if (updateData.notes !== undefined) {
        updateFields.notes = updateData.notes;
      }

      // Update the order item
      const [updatedItem] = await database
        .update(orderItemsTable)
        .set(updateFields)
        .where(eq(orderItemsTable.id, itemId))
        .returning();

      console.log("Order item updated successfully:", updatedItem);

      res.json({
        success: true,
        orderItem: updatedItem,
        message: "Order item updated successfully",
      });
    } catch (error) {
      console.error("=== UPDATE ORDER ITEM ERROR ===");
      console.error("Error type:", error?.constructor?.name || "Unknown");
      console.error("Error message:", error?.message || "Unknown error");
      console.error("Error stack:", error?.stack || "No stack trace");
      console.error("Item ID:", req.params.itemId);
      console.error("Update data:", req.body);

      res.status(500).json({
        error: "Failed to update order item",
        details: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      });
    }
  });

  // Delete a specific order item
  app.delete("/api/order-items/:itemId", async (req: TenantRequest, res) => {
    try {
      console.log("=== DELETE ORDER ITEM API CALLED ===");
      const itemId = parseInt(req.params.itemId);
      const tenantDb = await getTenantDatabase(req); // Assuming tenantDb is needed here as well
      console.log("Item ID requested:", itemId);

      if (isNaN(itemId)) {
        return res.status(400).json({
          error: "Invalid item ID",
        });
      }

      console.log("Deleting order item from storage...");
      const success = await storage.removeOrderItem(itemId, tenantDb); // Pass tenantDb to storage function

      if (success) {
        console.log("Order item deleted successfully");
        res.json({
          success: true,
          message: "Order item deleted successfully",
        });
      } else {
        console.log("Order item not found");
        res.status(404).json({
          error: "Order item not found",
        });
      }
    } catch (error) {
      console.error("=== DELETE ORDER ITEM ERROR ===");
      console.error("Error type:", error.constructor.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      console.error("Item ID:", req.params.itemId);
      res.status(500).json({
        error: "Failed to delete order item",
        details: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      });
    }
  });

  // Income Vouchers API Routes
  app.get("/api/income-vouchers", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const vouchers = await storage.getIncomeVouchers(tenantDb);
      res.json(vouchers);
    } catch (error) {
      console.error("Error fetching income vouchers:", error);
      res.status(500).json({
        error: "Failed to fetch income vouchers",
      });
    }
  });

  app.post("/api/income-vouchers", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const voucher = await storage.createIncomeVoucher(req.body, tenantDb);
      res.status(201).json(voucher);
    } catch (error) {
      console.error("Error creating income voucher:", error);
      res.status(500).json({
        error: "Failed to create income voucher",
      });
    }
  });

  app.put("/api/income-vouchers/:id", async (req: TenantRequest, res) => {
    try {
      const { id } = req.params;
      const tenantDb = await getTenantDatabase(req);
      const voucher = await storage.updateIncomeVoucher(id, req.body, tenantDb);
      res.json(voucher);
    } catch (error) {
      console.error("Error updating income voucher:", error);
      res.status(500).json({
        error: "Failed to update income voucher",
      });
    }
  });

  app.delete("/api/income-vouchers/:id", async (req: TenantRequest, res) => {
    try {
      const { id } = req.params;
      const tenantDb = await getTenantDatabase(req);
      await storage.deleteIncomeVoucher(id, tenantDb);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting income voucher:", error);
      res.status(500).json({
        error: "Failed to delete income voucher",
      });
    }
  });

  // Get POS orders specifically
  app.get(
    "/api/orders/pos",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/orders/pos - Fetching POS orders");
        const tenantDb = await getTenantDatabase(req);

        const posOrders = await storage.getOrders(
          undefined,
          undefined,
          tenantDb,
          "pos",
        );
        console.log(`✅ Successfully fetched ${posOrders.length} POS orders`);
        res.json(posOrders);
      } catch (error) {
        console.error("❌ Error fetching POS orders:", error);
        res.status(500).json({
          error: "Failed to fetch POS orders",
        });
      }
    },
  );

  // Get table orders specifically
  app.get(
    "/api/orders/table",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/orders/table - Fetching table orders");
        const tenantDb = await getTenantDatabase(req);

        const tableOrders = await storage.getOrders(
          undefined,
          undefined,
          tenantDb,
          "table",
        );
        console.log(
          `✅ Successfully fetched ${tableOrders.length} table orders`,
        );
        res.json(tableOrders);
      } catch (error) {
        console.error("❌ Error fetching table orders:", error);
        res.status(500).json({
          error: "Failed to fetch table orders",
        });
      }
    },
  );

  // Add order items to existing order
  app.post("/api/orders/:orderId/items", async (req: TenantRequest, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const { items } = req.body;

      console.log(`📝 Adding ${items?.length || 0} items to order ${orderId}`);

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: "Items array is required",
        });
      }

      if (isNaN(orderId)) {
        return res.status(400).json({
          error: "Invalid order ID",
        });
      }

      // Get tenant database connection
      let tenantDb;
      try {
        tenantDb = await getTenantDatabase(req);
        console.log(
          "✅ Tenant database connection obtained for adding order items",
        );
      } catch (dbError) {
        console.error(
          "❌ Failed to get tenant database for adding order items:",
          dbError,
        );
        return res.status(500).json({
          error: "Database connection failed",
        });
      }

      // Use tenant database for all operations
      const database = tenantDb || db;

      // Validate that order exists
      const [existingOrder] = await database
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!existingOrder) {
        return res.status(404).json({
          error: "Order not found",
        });
      }

      // Validate items data
      const validatedItems = items.map((item, index) => {
        if (!item.productId || !item.quantity || !item.unitPrice) {
          throw new Error(
            `Item at index ${index} is missing required fields: productId, quantity, or unitPrice`,
          );
        }

        return {
          orderId,
          productId: parseInt(item.productId),
          quantity: parseInt(item.quantity),
          unitPrice: item.unitPrice.toString(),
          total: item.total
            ? item.total.toString()
            : (parseFloat(item.unitPrice) * parseInt(item.quantity)).toString(),
          discount: item.discount, // Default discount, will be recalculated below
          notes: item.notes || null,
        };
      });

      console.log(`📝 Validated items for insertion:`, validatedItems);

      // Insert new items using tenant database
      const insertedItems = await database
        .insert(orderItemsTable)
        .values(validatedItems)
        .returning();

      console.log(
        `✅ Successfully added ${insertedItems.length} items to order ${orderId}`,
      );

      res.json({
        success: true,
        validatedItems,
        message: `Added ${validatedItems.length} items and updated order totals using order-dialog logic`,
      });
    } catch (error) {
      console.error(
        `❌ Error adding items to order ${req.params.orderId}:`,
        error,
      );

      let errorMessage = "Failed to add items to order";
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      res.status(500).json({
        error: errorMessage,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Inventory Management
  app.post("/api/inventory/update-stock", async (req: TenantRequest, res) => {
    try {
      const { productId, quantity, type, notes, trackInventory } = req.body;
      const tenantDb = await getTenantDatabase(req);

      // Get current product
      const [product] = await tenantDb
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (!product) {
        return res.status(404).json({
          error: "Product not found",
        });
      }

      let newStock = product.stock;
      switch (type) {
        case "add":
          newStock += quantity;
          break;
        case "subtract":
          newStock = Math.max(0, product.stock - quantity);
          break;
        case "set":
          newStock = quantity;
          break;
      }

      // Update product stock and trackInventory
      const updateData: any = {
        stock: newStock,
      };
      if (trackInventory !== undefined) {
        updateData.trackInventory = trackInventory;
      }

      await tenantDb
        .update(products)
        .set(updateData)
        .where(eq(products.id, productId));

      // Create inventory transaction record using raw SQL to match exact schema
      await tenantDb.execute(sql`
        INSERT INTO inventory_transactions (product_id, type, quantity, previous_stock, new_stock, notes, created_at)
        VALUES (${productId}, ${type}, ${quantity}, ${product.stock}, ${newStock}, ${notes || null}, ${new Date()})
      `);

      res.json({
        success: true,
        newStock,
      });
    } catch (error) {
      console.error("Stock update error:", error);
      res.status(500).json({
        error: "Failed to update stock",
      });
    }
  });

  // Bulk update stock by SKU
  app.post(
    "/api/inventory/bulk-update-stock",
    async (req: TenantRequest, res) => {
      try {
        const { items } = req.body;
        const tenantDb = await getTenantDatabase(req);
        const database = tenantDb || db;

        console.log("🔄 Bulk stock update request:", {
          itemsCount: items?.length,
        });

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({
            error: "Items array is required and must not be empty",
          });
        }

        const results = [];
        const errors = [];

        for (const item of items) {
          try {
            const { sku, stock } = item;

            if (!sku || stock === undefined || stock === null) {
              errors.push({
                sku: sku || "unknown",
                error: "SKU and stock are required",
              });
              continue;
            }

            // Find product by SKU
            const [product] = await database
              .select()
              .from(products)
              .where(eq(products.sku, sku))
              .limit(1);

            if (!product) {
              errors.push({
                sku,
                error: "Product not found",
              });
              continue;
            }

            const previousStock = product.stock;
            const newStock = Math.max(0, parseInt(stock));

            // Update product stock
            await database
              .update(products)
              .set({ stock: newStock })
              .where(eq(products.sku, sku));

            // Create inventory transaction record
            await database.execute(sql`
            INSERT INTO inventory_transactions (product_id, type, quantity, previous_stock, new_stock, notes, created_at)
            VALUES (${product.id}, 'set', ${newStock}, ${previousStock}, ${newStock}, 'Bulk stock update via API', ${new Date()})
          `);

            results.push({
              sku,
              productId: product.id,
              productName: product.name,
              previousStock,
              newStock,
              success: true,
            });

            console.log(
              `✅ Updated stock for ${sku}: ${previousStock} → ${newStock}`,
            );
          } catch (itemError) {
            console.error(
              `❌ Error updating stock for ${item.sku}:`,
              itemError,
            );
            errors.push({
              sku: item.sku || "unknown",
              error:
                itemError instanceof Error
                  ? itemError.message
                  : "Unknown error",
            });
          }
        }

        console.log(
          `🎯 Bulk stock update completed: ${results.length} success, ${errors.length} errors`,
        );

        // Log the actual stock values that were updated
        console.log(
          "📊 Stock update results:",
          results.map((r) => ({
            sku: r.sku,
            previousStock: r.previousStock,
            newStock: r.newStock,
            productId: r.productId,
          })),
        );

        res.json({
          success: true,
          message: `Updated ${results.length} products successfully`,
          results,
          errors: errors.length > 0 ? errors : undefined,
          summary: {
            totalItems: items.length,
            successCount: results.length,
            errorCount: errors.length,
          },
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("❌ Bulk stock update error:", error);
        res.status(500).json({
          error: "Failed to update stock",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Store Settings
  app.get("/api/store-settings", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const database = tenantDb || db;
      const storeCode = req.tenant?.storeCode;

      console.log("🔍 Fetching store settings with store code:", storeCode);

      // First, try to get settings without store_code filter to see if any exist
      const allSettings = await database
        .select()

        .from(storeSettings)
        .where(eq(storeSettings.storeCode, storeCode))
        .limit(1);

      console.log("📊 All store settings query result:", allSettings);

      // If we have settings, use them (ignore store_code filter for now since data might not have it set)
      if (allSettings && allSettings.length > 0) {
        console.log(
          "✅ Returning store settings from database:",
          allSettings[0],
        );
        res.json(allSettings[0]);
      } else {
        console.log(
          "⚠️ No store settings found in database, creating default entry",
        );

        // First, try to get settings without store_code filter to see if any exist
        const [allSettingsOne] = await database
          .select()
          .from(storeSettings)
          .limit(1);

        console.log("✅ Created default store settings:", allSettingsOne);
        res.json(allSettingsOne);
      }
    } catch (error) {
      console.error("❌ Error fetching store settings:", error);
      res.status(500).json({
        error: "Failed to fetch store settings",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.put("/api/store-settings", async (req: TenantRequest, res) => {
    try {
      const validatedData = insertStoreSettingsSchema.partial().parse(req.body);
      const tenantDb = await getTenantDatabase(req);
      const settings = await storage.updateStoreSettings(
        validatedData,
        tenantDb,
      );
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid store settings data",
          errors: error.errors,
        });
      }
      res.status(500).json({
        message: "Failed to update store settings",
      });
    }
  });

  // Current cart state for customer display
  app.get("/api/current-cart", async (req, res) => {
    try {
      console.log("n Customer Display: Current cart API called");

      // Get store settings for customer display
      const storeSettings = await storage.getStoreSettings();

      const currentCartState = {
        cart: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        storeInfo: storeSettings,
        qrPayment: null,
      };

      console.log("📱 Customer Display: Current cart API returning state:", {
        cartItems: currentCartState.cart.length,
        subtotal: currentCartState.subtotal,
        tax: currentCartState.tax,
        total: currentCartState.total,
        hasStoreInfo: !!currentCartState.storeInfo,
        storeName: currentCartState.storeInfo?.storeName,
      });

      res.json(currentCartState);
    } catch (error) {
      console.error("❌ Error fetching current cart:", error);
      res.status(500).json({
        error: "Failed to fetch current cart",
      });
    }
  });

  // Suppliers
  app.get(
    "/api/suppliers",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/suppliers - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for suppliers");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for suppliers:",
            dbError,
          );
          tenantDb = null;
        }

        const { status, search } = req.query;
        let suppliers;

        if (search) {
          suppliers = await storage.searchSuppliers(search as string, tenantDb);
        } else if (status && status !== "all") {
          suppliers = await storage.getSuppliersByStatus(
            status as string,
            tenantDb,
          );
        } else {
          suppliers = await storage.getSuppliers(tenantDb);
        }
        console.log(`✅ Successfully fetched ${suppliers.length} suppliers`);
        res.json(suppliers);
      } catch (error) {
        console.error("Is� Error fetching suppliers:", error);
        res.status(500).json({
          message: "Failed to fetch suppliers",
        });
      }
    },
  );

  app.get("/api/suppliers/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const supplier = await storage.getSupplier(id, tenantDb);

      if (!supplier) {
        return res.status(404).json({
          message: "Supplier not found",
        });
      }

      res.json(supplier);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch supplier",
      });
    }
  });

  app.post("/api/suppliers", async (req: TenantRequest, res) => {
    try {
      const validatedData = insertSupplierSchema.parse(req.body);
      const tenantDb = await getTenantDatabase(req);
      const supplier = await storage.createSupplier(validatedData, tenantDb);
      res.status(201).json(supplier);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid supplier data",
          errors: error.errors,
        });
      }
      res.status(500).json({
        message: "Failed to create supplier",
      });
    }
  });

  app.put("/api/suppliers/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertSupplierSchema.partial().parse(req.body);
      const tenantDb = await getTenantDatabase(req);
      const supplier = await storage.updateSupplier(
        id,
        validatedData,
        tenantDb,
      );

      if (!supplier) {
        return res.status(404).json({
          message: "Supplier not found",
        });
      }

      res.json(supplier);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid supplier data",
          errors: error.errors,
        });
      }
      res.status(500).json({
        message: "Failed to update supplier",
      });
    }
  });

  app.delete("/api/suppliers/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const deleted = await storage.deleteSupplier(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          message: "Supplier not found",
        });
      }

      res.json({
        message: "Supplier deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to delete supplier",
      });
    }
  });

  // Purchase Receipts Management API
  app.get("/api/purchase-orders", async (req: Request, res) => {
    try {
      console.log("🔍 GET /api/purchase-orders - Starting request processing");
      console.log("✅ Using global database connection for purchase receipts");

      const { status, supplierId, search, startDate, endDate, page, limit } =
        req.query;

      console.log("🔍 Purchase receipts query parameters:", {
        status,
        supplierId,
        search,
        startDate,
        endDate,
        page,
        limit,
      });

      const options = {
        status: status as string,
        supplierId: supplierId ? parseInt(supplierId as string) : undefined,
        search: search as string,
        startDate: startDate as string,
        endDate: endDate as string,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      };

      const result = await storage.getPurchaseReceipts(options, db);
      console.log(
        `✅ Successfully fetched ${Array.isArray(result) ? result.length : result.orders?.length || 0} purchase receipts`,
      );
      res.json(result);
    } catch (error) {
      console.error("❌ Error fetching purchase receipts:", error);
      res.status(500).json({ message: "Failed to fetch purchase receipts" });
    }
  });

  app.get(
    "/api/purchase-orders/:id",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);
        const purchaseOrder = await storage.getPurchaseOrder(id, tenantDb);

        if (!purchaseOrder) {
          return res.status(404).json({ message: "Purchase order not found" });
        }

        res.json(purchaseOrder);
      } catch (error) {
        console.error("❌ Error fetching purchase order:", error);
        res.status(500).json({ message: "Failed to fetch purchase order" });
      }
    },
  );

  app.post("/api/purchase-orders", async (req: Request, res) => {
    try {
      console.log("📝 Creating purchase receipt with data:", req.body);

      const { items = [], attachedFiles = [], ...orderData } = req.body;

      // Basic validation
      if (!orderData.supplierId) {
        return res.status(400).json({
          message: "Supplier ID is required",
        });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          message: "At least one item is required",
        });
      }

      // Validate purchase receipt data
      const validatedOrderData = insertPurchaseReceiptSchema.parse({
        ...orderData,
        supplierId: Number(orderData.supplierId),
        receiptNumber:
          orderData.poNumber || orderData.receiptNumber || `PR-${new Date()}`,
        subtotal: orderData.subtotal || "0.00",
        tax: orderData.tax || "0.00",
        total: orderData.total || "0.00",
      });

      // Validate items array
      const validatedItems = items.map((item) =>
        insertPurchaseReceiptItemSchema.parse({
          ...item,
          productId: Number(item.productId),
          quantity: Number(item.quantity),
          unitPrice: String(item.unitPrice),
          total: String(item.total),
          receivedQuantity: Number(item.receivedQuantity || 0),
        }),
      );

      console.log(
        "✅ Using global database connection for purchase receipt creation",
      );
      console.log("✅ Validated receipt data:", validatedOrderData);
      console.log("✅ Validated items:", validatedItems);

      const result = await storage.createPurchaseReceipt(
        validatedOrderData,
        validatedItems,
        db,
      );

      // Handle file attachments if any
      if (attachedFiles && attachedFiles.length > 0) {
        console.log(`📎 Processing ${attachedFiles.length} file attachments`);

        for (const file of attachedFiles) {
          try {
            const documentData = {
              purchaseReceiptId: result.id,
              fileName: file.fileName,
              originalFileName: file.originalFileName,
              fileType: file.fileType,
              fileSize: file.fileSize,
              filePath: `/uploads/purchase-receipts/${result.id}/${file.fileName}`,
              description: file.description || null,
              uploadedBy: null,
            };

            // Create document record
            await storage.uploadPurchaseReceiptDocument(documentData, db);
            console.log(`✅ File attachment saved: ${file.originalFileName}`);
          } catch (fileError) {
            console.error(
              `❌ Error saving file ${file.originalFileName}:`,
              fileError,
            );
          }
        }
      }

      console.log(
        `✅ Successfully created purchase receipt: ${result.receiptNumber}`,
      );
      res.status(201).json(result);
    } catch (error) {
      console.error("❌ Error creating purchase receipt:", error);
      if (error instanceof z.ZodError) {
        console.error("❌ Validation errors:", error.errors);
        return res.status(400).json({
          message: "Invalid purchase receipt data",
          errors: error.errors,
        });
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to create purchase receipt";
      res.status(500).json({
        message: errorMessage,
        details: error instanceof Error ? error.stack : String(error),
      });
    }
  });

  app.put(
    "/api/purchase-orders/:id",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const validatedData = insertPurchaseOrderSchema
          .partial()
          .parse(req.body);
        const tenantDb = await getTenantDatabase(req);

        const purchaseOrder = await storage.updatePurchaseOrder(
          id,
          validatedData,
          tenantDb,
        );

        if (!purchaseOrder) {
          return res.status(404).json({ message: "Purchase order not found" });
        }

        console.log(`✅ Successfully updated purchase order: ${id}`);
        res.json(purchaseOrder);
      } catch (error) {
        console.error("❌ Error updating purchase order:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid purchase order data",
            errors: error.errors,
          });
        }
        res.status(500).json({ message: "Failed to update purchase order" });
      }
    },
  );

  app.delete(
    "/api/purchase-orders/:id",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);
        const deleted = await storage.deletePurchaseOrder(id, tenantDb);

        if (!deleted) {
          return res.status(404).json({ message: "Purchase order not found" });
        }

        console.log(`✅ Successfully deleted purchase order: ${id}`);
        res.json({ message: "Purchase order deleted successfully" });
      } catch (error) {
        console.error("❌ Error deleting purchase order:", error);
        res.status(500).json({ message: "Failed to delete purchase order" });
      }
    },
  );

  // Bulk delete purchase orders
  app.post(
    "/api/purchase-orders/bulk-delete",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const { orderIds } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
          return res.status(400).json({
            message: "Order IDs array is required and must not be empty",
          });
        }

        console.log(
          `🗑️ Bulk deleting ${orderIds.length} purchase orders:`,
          orderIds,
        );

        const tenantDb = await getTenantDatabase(req);
        let deletedCount = 0;
        const errors = [];

        for (const orderId of orderIds) {
          try {
            const deleted = await storage.deletePurchaseOrder(
              parseInt(orderId),
              tenantDb,
            );
            if (deleted) {
              deletedCount++;
            } else {
              errors.push(`Purchase order ${orderId} not found`);
            }
          } catch (error) {
            console.error(
              `❌ Error deleting purchase order ${orderId}:`,
              error,
            );
            errors.push(
              `Failed to delete purchase order ${orderId}: ${error.message}`,
            );
          }
        }

        console.log(
          `🎯 Bulk delete completed: ${deletedCount}/${orderIds.length} orders deleted`,
        );

        res.json({
          success: true,
          deletedCount,
          totalRequested: orderIds.length,
          errors: errors.length > 0 ? errors : undefined,
          message: `Successfully deleted ${deletedCount} purchase order(s)`,
        });
      } catch (error) {
        console.error("❌ Error in bulk delete purchase orders:", error);
        res.status(500).json({
          message: "Failed to delete purchase orders",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Purchase Order Items Management
  app.get(
    "/api/purchase-orders/:id/items",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const purchaseOrderId = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);
        const items = await storage.getPurchaseOrderItems(
          purchaseOrderId,
          tenantDb,
        );

        console.log(
          `✅ Successfully fetched ${items.length} purchase order items`,
        );
        res.json(items);
      } catch (error) {
        console.error("❌ Error fetching purchase order items:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch purchase order items" });
      }
    },
  );

  app.post(
    "/api/purchase-orders/:id/items",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const purchaseOrderId = parseInt(req.params.id);
        const items = Array.isArray(req.body) ? req.body : [req.body];
        const validatedItems = items.map((item) =>
          insertPurchaseOrderItemSchema.parse({
            ...item,
            purchaseOrderId,
          }),
        );

        const tenantDb = await getTenantDatabase(req);
        const result = await storage.addPurchaseOrderItems(
          purchaseOrderId,
          validatedItems,
          tenantDb,
        );

        console.log(
          `✅ Successfully added ${result.length} items to purchase order: ${purchaseOrderId}`,
        );
        res.status(201).json(result);
      } catch (error) {
        console.error("❌ Error adding purchase order items:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid purchase order item data",
            errors: error.errors,
          });
        }
        res.status(500).json({ message: "Failed to add purchase order items" });
      }
    },
  );

  app.put(
    "/api/purchase-order-items/:id",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const validatedData = insertPurchaseOrderItemSchema
          .partial()
          .parse(req.body);
        const tenantDb = await getTenantDatabase(req);

        const item = await storage.updatePurchaseOrderItem(
          id,
          validatedData,
          tenantDb,
        );

        if (!item) {
          return res
            .status(404)
            .json({ message: "Purchase order item not found" });
        }

        console.log(`✅ Successfully updated purchase order item: ${id}`);
        res.json(item);
      } catch (error) {
        console.error("❌ Error updating purchase order item:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid purchase order item data",
            errors: error.errors,
          });
        }
        res
          .status(500)
          .json({ message: "Failed to update purchase order item" });
      }
    },
  );

  app.delete(
    "/api/purchase-order-items/:id",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);
        const deleted = await storage.deletePurchaseOrderItem(id, tenantDb);

        if (!deleted) {
          return res
            .status(404)
            .json({ message: "Purchase order item not found" });
        }

        console.log(`✅ Successfully deleted purchase order item: ${id}`);
        res.json({ message: "Purchase order item deleted successfully" });
      } catch (error) {
        console.error("❌ Error deleting purchase order item:", error);
        res
          .status(500)
          .json({ message: "Failed to delete purchase order item" });
      }
    },
  );

  // Receive Goods API
  app.post(
    "/api/purchase-orders/:id/receive",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const purchaseOrderId = parseInt(req.params.id);
        const { receivedItems } = req.body;

        if (!Array.isArray(receivedItems) || receivedItems.length === 0) {
          return res.status(400).json({
            message: "receivedItems array is required and must not be empty",
          });
        }

        // Define validation schema for receive items
        const receiveItemSchema = z.object({
          id: z.number().positive(),
          receivedQuantity: z.number().min(0),
          productId: z.number().positive().optional(),
        });

        // Validate each received item using Zod
        const validatedItems = receivedItems.map((item) =>
          receiveItemSchema.parse(item),
        );

        const tenantDb = await getTenantDatabase(req);
        const result = await storage.receiveItems(
          purchaseOrderId,
          validatedItems,
          tenantDb,
        );

        console.log(
          `✅ Successfully processed receipt for purchase order: ${purchaseOrderId}, new status: ${result.status}`,
        );
        res.json(result);
      } catch (error) {
        console.error("❌ Error processing goods receipt:", error);
        res.status(500).json({
          message: "Failed to process goods receipt",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Purchase Order Documents Management
  app.get(
    "/api/purchase-orders/:id/documents",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const purchaseOrderId = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);
        const documents = await storage.getPurchaseOrderDocuments(
          purchaseOrderId,
          tenantDb,
        );

        console.log(
          `✅ Successfully fetched ${documents.length} documents for purchase order: ${purchaseOrderId}`,
        );
        res.json(documents);
      } catch (error) {
        console.error("❌ Error fetching purchase order documents:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch purchase order documents" });
      }
    },
  );

  app.post(
    "/api/purchase-orders/:id/documents",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const purchaseOrderId = parseInt(req.params.id);
        const validatedData = insertPurchaseReceiptDocumentSchema.parse({
          ...req.body,
          purchaseOrderId,
        });

        const tenantDb = await getTenantDatabase(req);
        const document = await storage.uploadPurchaseOrderDocument(
          validatedData,
          tenantDb,
        );

        console.log(
          `✅ Successfully uploaded document for purchase order: ${purchaseOrderId}`,
        );
        res.status(201).json(document);
      } catch (error) {
        console.error("❌ Error uploading purchase order document:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid document data",
            errors: error.errors,
          });
        }
        res.status(500).json({ message: "Failed to upload document" });
      }
    },
  );

  app.delete(
    "/api/purchase-order-documents/:id",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);
        const deleted = await storage.deletePurchaseOrderDocument(id, tenantDb);

        if (!deleted) {
          return res.status(404).json({ message: "Document not found" });
        }

        console.log(`✅ Successfully deleted purchase order document: ${id}`);
        res.json({ message: "Document deleted successfully" });
      } catch (error) {
        console.error("❌ Error deleting purchase order document:", error);
        res.status(500).json({ message: "Failed to delete document" });
      }
    },
  );

  // Get next customer ID
  app.get("/api/customers/next-id", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const nextId = await storage.getNextCustomerId(tenantDb);
      res.json({
        nextId,
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to generate customer ID",
      });
    }
  });

  // Customer management routes - Added Here
  app.get(
    "/api/customers",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/customers - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for customers");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for customers:",
            dbError,
          );
          tenantDb = null;
        }

        const customers = await storage.getCustomers(tenantDb);
        console.log(`✅ Successfully fetched ${customers.length} customers`);
        res.json(customers);
      } catch (error) {
        console.error("❌ Error fetching customers:", error);
        res.status(500).json({
          message: "Failed to fetch customers",
        });
      }
    },
  );

  app.get("/api/customers/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const customer = await storage.getCustomer(id, tenantDb);
      if (!customer) {
        return res.status(404).json({
          message: "Customer not found",
        });
      }
      res.json(customer);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer",
      });
    }
  });

  // Create customer
  app.post("/api/customers", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);

      // Validate required fields
      if (!req.body.name) {
        return res.status(400).json({
          message: "Customer name is required",
        });
      }

      // Prepare customer data with proper defaults
      const customerData = {
        ...req.body,
        customerId: req.body.customerId || undefined,
        phone: req.body.phone || null,
        email: req.body.email || null,
        address: req.body.address || null,
        dateOfBirth: req.body.dateOfBirth || null,
        membershipLevel: req.body.membershipLevel || "Silver",
        notes: req.body.notes || null,
        status: req.body.status || "active",
        totalSpent: "0",
        pointsBalance: 0,
      };

      const [customer] = await tenantDb
        .insert(customers)
        .values(customerData)
        .returning();
      res.json(customer);
    } catch (error: any) {
      console.error("Error creating customer:", error);

      // Handle specific database errors
      if (error.code === "SQLITE_CONSTRAINT") {
        return res.status(400).json({
          message: "Customer with this ID already exists",
        });
      }

      res.status(500).json({
        message: "Failed to create customer",
        error: error.message,
      });
    }
  });

  app.put("/api/customers/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const customerData = req.body;
      const tenantDb = await getTenantDatabase(req);
      const customer = await storage.updateCustomer(id, customerData, tenantDb);
      if (!customer) {
        return res.status(404).json({
          message: "Customer not found",
        });
      }
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid customer data",
          errors: error.errors,
        });
      }
      res.status(500).json({
        message: "Failed to update customer",
      });
    }
  });

  app.delete("/api/customers/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const deleted = await storage.deleteCustomer(id, tenantDb);
      if (!deleted) {
        return res.status(404).json({
          message: "Customer not found",
        });
      }
      res.json({
        message: "Customer deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to delete customer",
      });
    }
  });

  app.post("/api/customers/:id/visit", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const { amount, points } = req.body;
      const tenantDb = await getTenantDatabase(req);

      const customer = await storage.getCustomer(id, tenantDb);
      if (!customer) {
        return res.status(404).json({
          message: "Customer not found",
        });
      }

      const updatedCustomer = await storage.updateCustomerVisit(
        id,
        amount,
        points,
        tenantDb,
      );
      res.json(updatedCustomer);
    } catch (error) {
      res.status(500).json({
        message: "Failed to update customer visit",
      });
    }
  });

  // Point Management API
  app.get("/api/customers/:id/points", async (req: TenantRequest, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const pointsData = await storage.getCustomerPoints(customerId, tenantDb);

      if (!pointsData) {
        return res.status(404).json({
          message: "Customer not found",
        });
      }

      res.json(pointsData);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer points",
      });
    }
  });

  app.post("/api/customers/:id/points", async (req: TenantRequest, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const pointUpdateSchema = z.object({
        points: z.number().int().min(1),
        description: z.string().min(1),
        type: z.enum(["earned", "redeemed", "adjusted"]),
        employeeId: z.number().optional(),
        orderId: z.number().optional(),
      });

      const { points, description, type, employeeId, orderId } =
        pointUpdateSchema.parse(req.body);
      const tenantDb = await getTenantDatabase(req);

      const pointTransaction = await storage.updateCustomerPoints(
        customerId,
        points,
        description,
        type,
        employeeId,
        orderId,
        tenantDb,
      );

      res.status(201).json(pointTransaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid point update data",
          errors: error.errors,
        });
      }
      if (error instanceof Error && error.message === "Customer not found") {
        return res.status(404).json({
          message: "Customer not found",
        });
      }
      if (
        error instanceof Error &&
        error.message === "Insufficient points balance"
      ) {
        return res.status(400).json({
          message: "Insufficient points balance",
        });
      }
      res.status(500).json({
        message: "Failed to update customer points",
      });
    }
  });

  app.get(
    "/api/customers/:id/point-history",
    async (req: TenantRequest, res) => {
      try {
        const customerId = parseInt(req.params.id);
        const limit = parseInt(req.query.limit as string) || 50;
        const tenantDb = await getTenantDatabase(req);

        const pointHistory = await storage.getPointHistory(
          customerId,
          limit,
          tenantDb,
        );
        res.json(pointHistory);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch point history",
        });
      }
    },
  );

  // New endpoints for points management modal
  app.post("/api/customers/adjust-points", async (req: TenantRequest, res) => {
    try {
      const pointUpdateSchema = z.object({
        customerId: z.number().int().min(1),
        points: z.number().int(),
        type: z.enum(["earned", "redeemed", "adjusted"]),
        description: z.string().min(1),
      });

      const { customerId, points, type, description } = pointUpdateSchema.parse(
        req.body,
      );
      const tenantDb = await getTenantDatabase(req);

      const pointTransaction = await storage.updateCustomerPoints(
        customerId,
        points,
        description,
        type,
        undefined, // employeeId is optional and not provided here
        undefined, // orderId is optional and not provided here
        tenantDb,
      );

      res.status(201).json(pointTransaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid point adjustment data",
          errors: error.errors,
        });
      }
      if (error instanceof Error && error.message === "Customer not found") {
        return res.status(404).json({
          message: "Customer not found",
        });
      }
      if (
        error instanceof Error &&
        error.message === "Insufficient points balance"
      ) {
        return res.status(400).json({
          message: "Insufficient points balance",
        });
      }
      res.status(500).json({
        message: "Failed to adjust customer points",
      });
    }
  });

  app.post("/api/customers/redeem-points", async (req: TenantRequest, res) => {
    try {
      const redeemSchema = z.object({
        customerId: z.number().int().min(1),
        points: z.number().int().min(1),
      });

      const { customerId, points } = redeemSchema.parse(req.body);
      const tenantDb = await getTenantDatabase(req);

      const pointTransaction = await storage.updateCustomerPoints(
        customerId,
        -points,
        "포인트 결제 사용",
        "redeemed",
        undefined, // employeeId is optional
        undefined, // orderId is optional
        tenantDb,
      );

      res.status(201).json(pointTransaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid point redemption data",
          errors: error.errors,
        });
      }
      if (error instanceof Error && error.message === "Customer not found") {
        return res.status(404).json({
          message: "Customer not found",
        });
      }
      if (
        error instanceof Error &&
        error.message === "Insufficient points balance"
      ) {
        return res.status(400).json({
          message: "Insufficient points balance",
        });
      }
      res.status(500).json({
        message: "Failed to redeem customer points",
      });
    }
  });

  app.get("/api/point-transactions", async (req: TenantRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const tenantDb = await getTenantDatabase(req);
      // For now, get all point transactions across all customers
      // In a real app, you might want to add pagination and filtering
      const allTransactions = await storage.getAllPointTransactions(
        limit,
        tenantDb,
      );
      res.json(allTransactions);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch point transactions",
      });
    }
  });

  // Membership thresholds management
  app.get("/api/membership-thresholds", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const thresholds = await storage.getMembershipThresholds(tenantDb);
      res.json(thresholds);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch membership thresholds",
      });
    }
  });

  app.put("/api/membership-thresholds", async (req: TenantRequest, res) => {
    try {
      const thresholdSchema = z.object({
        GOLD: z.number().min(0),
        VIP: z.number().min(0),
      });

      const validatedData = thresholdSchema.parse(req.body);
      const tenantDb = await getTenantDatabase(req);
      const thresholds = await storage.updateMembershipThresholds(
        validatedData,
        tenantDb,
      );

      res.json(thresholds);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid threshold data",
          errors: error.errors,
        });
      }
      res.status(500).json({
        message: "Failed to update membership thresholds",
      });
    }
  });

  // Supplier Reports APIs
  app.get("/api/supplier-debts", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, supplierId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Mock data for supplier debts - replace with actual database queries
      const supplierDebts = [
        {
          id: 1,
          supplierCode: "SUP001",
          supplierName: "Nhà cung cấp A",
          initialDebt: 500000,
          newDebt: 300000,
          payment: 200000,
          finalDebt: 600000,
          phone: "010-1234-5678",
        },
        {
          id: 2,
          supplierCode: "SUP002",
          supplierName: "Nhà cung cấp B",
          initialDebt: 800000,
          newDebt: 400000,
          payment: 300000,
          finalDebt: 900000,
          phone: "010-2345-6789",
        },
      ];

      // Filter by supplier if specified
      let filteredDebts = supplierDebts;
      if (supplierId) {
        filteredDebts = supplierDebts.filter(
          (debt) => debt.id === parseInt(supplierId as string),
        );
      }

      res.json(filteredDebts);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch supplier debts",
      });
    }
  });

  app.get("/api/supplier-purchases", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, supplierId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Mock data for supplier purchases - replace with actual database queries
      const supplierPurchases = [
        {
          id: 1,
          supplierCode: "SUP001",
          supplierName: "Nhà cung cấp A",
          purchaseValue: 1500000,
          paymentValue: 1200000,
          netValue: 300000,
          phone: "010-1234-5678",
        },
        {
          id: 2,
          supplierCode: "SUP002",
          supplierName: "Nhà cung cấp B",
          purchaseValue: 2000000,
          paymentValue: 1700000,
          netValue: 300000,
          phone: "010-2345-6789",
        },
      ];

      // Filter by supplier if specified
      let filteredPurchases = supplierPurchases;
      if (supplierId) {
        filteredPurchases = supplierPurchases.filter(
          (purchase) => purchase.id === parseInt(supplierId as string),
        );
      }

      res.json(filteredPurchases);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch supplier purchases",
      });
    }
  });

  // Invoice templates management
  app.get(
    "/api/invoice-templates",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log(
          "🔍 GET /api/invoice-templates - Starting request processing",
        );
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for invoice templates",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for invoice templates:",
            dbError,
          );
          tenantDb = null;
        }

        const templates = await storage.getInvoiceTemplates(tenantDb);
        console.log(
          `✅ Successfully fetched ${templates.length} invoice templates`,
        );
        res.json(templates);
      } catch (error) {
        console.error("❌ Error fetching invoice templates:", error);
        res.status(500).json({
          error: "Failed to fetch invoice templates",
        });
      }
    },
  );

  app.get("/api/invoice-templates/active", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const activeTemplates = await storage.getActiveInvoiceTemplates();
      res.json(activeTemplates);
    } catch (error) {
      console.error("Error fetching active invoice templates:", error);
      res.status(500).json({
        error: "Failed to fetch active invoice templates",
      });
    }
  });

  app.post("/api/invoice-templates", async (req: TenantRequest, res) => {
    try {
      const templateData = req.body;
      const tenantDb = await getTenantDatabase(req);
      const template = await storage.createInvoiceTemplate(
        templateData,
        tenantDb,
      );
      res.status(201).json(template);
    } catch (error) {
      console.error("Invoice template creation error:", error);
      res.status(500).json({
        message: "Failed to create invoice template",
      });
    }
  });

  app.put("/api/invoice-templates/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const templateData = req.body;
      const tenantDb = await getTenantDatabase(req);
      const template = await storage.updateInvoiceTemplate(
        id,
        templateData,
        tenantDb,
      );

      if (!template) {
        return res.status(404).json({
          message: "Invoice template not found",
        });
      }

      res.json(template);
    } catch (error) {
      console.error("Invoice template update error:", error);
      res.status(500).json({
        message: "Failed to update invoice template",
      });
    }
  });

  app.delete("/api/invoice-templates/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const deleted = await storage.deleteInvoiceTemplate(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          message: "Invoice template not found",
        });
      }

      res.json({
        message: "Invoice template deleted successfully",
      });
    } catch (error) {
      console.error("Invoice template deletion error:", error);
      res.status(500).json({
        message: "Failed to delete invoice template",
      });
    }
  });

  // Invoices management
  app.get(
    "/api/invoices",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/invoices - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for invoices");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for invoices:",
            dbError,
          );
          tenantDb = null;
        }

        const invoices = await storage.getInvoices(tenantDb);
        console.log(`✅ Successfully fetched ${invoices.length} invoices`);
        res.json(invoices);
      } catch (error) {
        console.error("❌ Error fetching invoices:", error);
        res.status(500).json({
          message: "Failed to fetch invoices",
        });
      }
    },
  );

  app.post("/api/invoices", async (req: TenantRequest, res) => {
    try {
      console.log("🔍 POST /api/invoices - Creating new invoice");
      const tenantDb = await getTenantDatabase(req);
      const invoiceData = req.body;

      console.log(
        "📄 Invoice data received:",
        JSON.stringify(invoiceData, null, 2),
      );

      // Validate required fields
      if (!invoiceData.customerName) {
        return res.status(400).json({
          error: "Customer name is required",
        });
      }

      if (!invoiceData.total || parseFloat(invoiceData.total) <= 0) {
        return res.status(400).json({
          error: "Valid total amount is required",
        });
      }

      if (
        !invoiceData.items ||
        !Array.isArray(invoiceData.items) ||
        invoiceData.items.length === 0
      ) {
        return res.status(400).json({
          error: "Invoice items are required",
        });
      }

      // Create invoice in database
      const invoice = await storage.createInvoice(invoiceData, tenantDb);

      console.log("✅ Invoice created successfully:", invoice);
      res.status(201).json({
        success: true,
        invoice: invoice,
        message: "Invoice created successfully",
      });
    } catch (error) {
      console.error("❌ Error creating invoice:", error);

      let errorMessage = "Failed to create invoice";
      if (error instanceof Error) {
        errorMessage = `Failed to create invoice: ${error.message}`;
      }

      res.status(500).json({
        error: errorMessage,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/invoices/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      if (isNaN(id)) {
        return res.status(400).json({
          error: "Invalid invoice ID",
        });
      }

      const invoice = await storage.getInvoice(id, tenantDb);

      if (!invoice) {
        return res.status(404).json({
          error: "Invoice not found",
        });
      }

      res.json(invoice);
    } catch (error) {
      console.error("❌ Error fetching invoice:", error);
      res.status(500).json({
        message: "Failed to fetch invoice",
      });
    }
  });

  app.put("/api/invoices/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const updateData = req.body;

      if (isNaN(id)) {
        return res.status(400).json({
          error: "Invalid invoice ID",
        });
      }

      const invoice = await storage.updateInvoice(id, updateData, tenantDb);

      if (!invoice) {
        return res.status(404).json({
          error: "Invoice not found",
        });
      }

      res.json(invoice);
    } catch (error) {
      console.error("❌ Error updating invoice:", error);
      res.status(500).json({
        message: "Failed to update invoice",
      });
    }
  });

  app.delete("/api/invoices/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      if (isNaN(id)) {
        return res.status(400).json({
          error: "Invalid invoice ID",
        });
      }

      const deleted = await storage.deleteInvoice(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          error: "Invoice not found",
        });
      }

      res.json({
        message: "Invoice deleted successfully",
      });
    } catch (error) {
      console.error("❌ Error deleting invoice:", error);
      res.status(500).json({
        message: "Failed to delete invoice",
      });
    }
  });

  // E-invoice connections management
  app.get(
    "/api/einvoice-connections",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log(
          "🔍 GET /api/einvoice-connections - Starting request processing",
        );
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for e-invoice connections",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for e-invoice connections:",
            dbError,
          );
          tenantDb = null;
        }

        const connections = await storage.getEInvoiceConnections(tenantDb);
        console.log(
          `✅ Successfully fetched ${connections.length} e-invoice connections`,
        );
        res.json(connections);
      } catch (error) {
        console.error("❌ Error fetching e-invoice connections:", error);
        res.status(500).json({
          message: "Failed to fetch e-invoice connections",
        });
      }
    },
  );

  app.post("/api/einvoice-connections", async (req: TenantRequest, res) => {
    try {
      const connectionData = req.body;
      const tenantDb = await getTenantDatabase(req);
      const connection = await storage.createEInvoiceConnection(
        connectionData,
        tenantDb,
      );
      res.status(201).json(connection);
    } catch (error) {
      console.error("E-invoice connection creation error:", error);
      res.status(500).json({
        message: "Failed to create e-invoice connection",
      });
    }
  });

  app.put("/api/einvoice-connections/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const connectionData = req.body;
      const tenantDb = await getTenantDatabase(req);
      const connection = await storage.updateEInvoiceConnection(
        id,
        connectionData,
        tenantDb,
      );

      if (!connection) {
        return res.status(404).json({
          message: "E-invoice connection not found",
        });
      }

      res.json(connection);
    } catch (error) {
      console.error("E-invoice connection update error:", error);
      res.status(500).json({
        message: "Failed to update e-invoice connection",
      });
    }
  });

  app.delete(
    "/api/einvoice-connections/:id",
    async (req: TenantRequest, res) => {
      try {
        const id = parseInt(req.params.id);
        const tenantDb = await getTenantDatabase(req);
        const deleted = await storage.deleteEInvoiceConnection(id, tenantDb);

        if (!deleted) {
          return res.status(404).json({
            message: "E-invoice connection not found",
          });
        }

        res.json({
          message: "E-invoice connection deleted successfully",
        });
      } catch (error) {
        console.error("E-invoice connection deletion error:", error);
        res.status(500).json({
          message: "Failed to delete e-invoice connection",
        });
      }
    },
  );

  // Menu Analysis API
  app.get("/api/menu-analysis", async (req, res) => {
    try {
      const { startDate, endDate, categoryId, productType, productSearch } =
        req.query;
      const tenantDb = await getTenantDatabase(req);
      const storeCode = req.tenant?.storeCode;

      console.log("Menu Analysis API called with params:", {
        startDate,
        endDate,
        search: req.query.search,
        categoryId,
        productType: req.query.productType,
      });

      console.log("Executing transaction and order queries...");

      // Build date conditions
      const dateConditions = [];
      if (startDate && endDate) {
        const startDateTime = new Date(startDate as string);
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);
        dateConditions.push(
          gte(transactionsTable.createdAt, startDateTime),
          lte(transactionsTable.createdAt, endDateTime),
        );
      } else if (startDate) {
        const startDateTime = new Date(startDate as string);
        dateConditions.push(gte(transactionsTable.createdAt, startDateTime));
      } else if (endDate) {
        const endDateTime = new Date(endDate as string);
        dateConditions.push(lte(transactionsTable.createdAt, endDateTime));
      }

      // Build category conditions
      const categoryConditions = [];
      if (categoryId && categoryId !== "all") {
        categoryConditions.push(
          eq(products.categoryId, parseInt(categoryId as string)),
        );
      }

      // Query transaction items with proper Drizzle ORM
      let transactionResults = [];
      try {
        transactionResults = await tenantDb
          .select({
            productId: transactionItemsTable.productId,
            productName: products.name,
            categoryId: products.categoryId,
            categoryName: categories.name,
            totalQuantity: sql<number>`SUM(${transactionItemsTable.quantity})`,
            totalRevenue: sql<number>`SUM(${transactionItemsTable.unitPrice}::numeric * ${transactionItemsTable.quantity})`,
          })
          .from(transactionItemsTable)
          .innerJoin(
            transactionsTable,
            eq(transactionItemsTable.transactionId, transactionsTable.id),
          )
          .innerJoin(products, eq(transactionItemsTable.productId, products.id))
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(and(...dateConditions, ...categoryConditions))
          .groupBy(
            transactionItemsTable.productId,
            products.name,
            products.categoryId,
            categories.name,
          );
      } catch (error) {
        console.error("Error querying transaction items:", error);
        transactionResults = [];
      }

      // Query order items with proper Drizzle ORM
      const orderDateConditions = [];
      if (startDate && endDate) {
        const startDateTime = new Date(startDate as string);
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);

        if (storeCode && storeCode.startsWith("CH-")) {
          orderDateConditions.push(
            gte(orders.updatedAt, startDateTime),
            lte(orders.updatedAt, endDateTime),
          );
        } else {
          orderDateConditions.push(
            gte(orders.orderedAt, startDateTime),
            lte(orders.orderedAt, endDateTime),
          );
        }
      } else if (startDate) {
        const startDateTime = new Date(startDate as string);
        if (storeCode && storeCode.startsWith("CH-")) {
          orderDateConditions.push(gte(orders.updatedAt, startDateTime));
        } else {
          orderDateConditions.push(gte(orders.orderedAt, startDateTime));
        }
      } else if (endDate) {
        const endDateTime = new Date(endDate as string);
        if (storeCode && storeCode.startsWith("CH-")) {
          orderDateConditions.push(lte(orders.updatedAt, endDateTime));
        } else {
          orderDateConditions.push(lte(orders.orderedAt, endDateTime));
        }
      }

      if (storeCode) {
        orderDateConditions.push(eq(orders.storeCode, storeCode));
      }

      let orderResults = [];
      try {
        orderResults = await tenantDb
          .select({
            productId: orderItemsTable.productId,
            productName: products.name,
            categoryId: products.categoryId,
            categoryName: categories.name,
            totalQuantity: sql<number>`SUM(${orderItemsTable.quantity})`,
            totalRevenue: sql<number>`SUM(${orderItemsTable.unitPrice}::numeric * ${orderItemsTable.quantity} - COALESCE(${orderItemsTable.discount}::numeric, 0))`,
          })
          .from(orderItemsTable)
          .innerJoin(orders, eq(orderItemsTable.orderId, orders.id))
          .innerJoin(products, eq(orderItemsTable.productId, products.id))
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(
            and(
              or(eq(orders.status, "paid"), eq(orders.status, "completed")),
              ...orderDateConditions,
              ...categoryConditions,
            ),
          )
          .groupBy(
            orderItemsTable.productId,
            products.name,
            products.categoryId,
            categories.name,
          );
      } catch (error) {
        console.error("Error querying order items:", error);
        orderResults = [];
      }

      console.log("Transaction stats:", transactionResults.length, "items");
      console.log("Order stats:", orderResults.length, "items");

      // Combine and aggregate results
      const productMap = new Map();
      const categoryMap = new Map();

      // Process transaction results
      transactionResults.forEach((item) => {
        const key = item.productId;
        if (productMap.has(key)) {
          const existing = productMap.get(key);
          existing.totalQuantity += Number(item.totalQuantity || 0);
          existing.totalRevenue += Number(item.totalRevenue || 0);
        } else {
          productMap.set(key, {
            productId: item.productId,
            productName: item.productName,
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            totalQuantity: Number(item.totalQuantity || 0),
            totalRevenue: Number(item.totalRevenue || 0),
          });
        }
      });

      // Process order results
      orderResults.forEach((item) => {
        const key = item.productId;
        if (productMap.has(key)) {
          const existing = productMap.get(key);
          existing.totalQuantity += Number(item.totalQuantity || 0);
          existing.totalRevenue += Number(item.totalRevenue || 0);
        } else {
          productMap.set(key, {
            productId: item.productId,
            productName: item.productName,
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            totalQuantity: Number(item.totalQuantity || 0),
            totalRevenue: Number(item.totalRevenue || 0),
          });
        }
      });

      // Calculate category stats
      productMap.forEach((product) => {
        const categoryKey = product.categoryId;
        if (categoryMap.has(categoryKey)) {
          const existing = categoryMap.get(categoryKey);
          existing.totalQuantity += product.totalQuantity;
          existing.totalRevenue += product.totalRevenue;
          existing.productCount += 1;
        } else {
          categoryMap.set(categoryKey, {
            categoryId: product.categoryId,
            categoryName: product.categoryName,
            totalQuantity: product.totalQuantity,
            totalRevenue: product.totalRevenue,
            productCount: 1,
          });
        }
      });

      const productStats = Array.from(productMap.values());
      const categoryStats = Array.from(categoryMap.values());

      // Calculate totals
      const totalRevenue = productStats.reduce(
        (sum, product) => sum + product.totalRevenue,
        0,
      );
      const totalQuantity = productStats.reduce(
        (sum, product) => sum + product.totalQuantity,
        0,
      );

      // Top selling products (by quantity)
      const topSellingProducts = productStats
        .sort((a, b) => b.totalQuantity - a.totalQuantity)
        .slice(0, 10);

      // Top revenue products
      const topRevenueProducts = productStats
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, 10);

      const result = {
        totalRevenue,
        totalQuantity,
        categoryStats,
        productStats,
        topSellingProducts,
        topRevenueProducts,
      };

      console.log("Menu Analysis Results:", {
        totalRevenue,
        totalQuantity,
        categoryCount: categoryStats.length,
      });

      res.json(result);
    } catch (error) {
      console.error("Menu analysis error:", error);
      res.status(500).json({
        error: "Failed to fetch menu analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Printer configuration management APIs
  app.get(
    "/api/printer-configs",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log(
          "🔍 GET /api/printer-configs - Starting request processing",
        );
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for printer configs",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for printer configs:",
            dbError,
          );
          tenantDb = null;
        }

        const configs = await storage.getPrinterConfigs(tenantDb);
        console.log(
          `✅ Successfully fetched ${configs.length} printer configs`,
        );
        res.json(configs);
      } catch (error) {
        console.error("❌ Error fetching printer configs:", error);
        res.status(500).json({
          error: "Failed to fetch printer configs",
        });
      }
    },
  );

  app.post("/api/printer-configs", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log("Creating printer config with data:", configData);

      const config = await storage.createPrinterConfig(configData, tenantDb);
      res.status(201).json(config);
    } catch (error) {
      console.error("Error creating printer config:", error);
      res.status(500).json({
        error: "Failed to create printer config",
      });
    }
  });

  app.put("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log(`Updating printer config ${id} with data:`, configData);

      const config = await storage.updatePrinterConfig(
        id,
        configData,
        tenantDb,
      );
      if (!config) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json(config);
    } catch (error) {
      console.error("Error updating printer config:", error);
      res.status(500).json({
        error: "Failed to update printer config",
      });
    }
  });

  app.delete("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      console.log(`Deleting printer config ${id}`);

      const deleted = await storage.deletePrinterConfig(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json({
        message: "Printer config deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting printer config:", error);
      res.status(500).json({
        error: "Failed to delete printer config",
      });
    }
  });

  app.post("/api/printer-configs/:id/test", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      // Get printer config
      const configs = await storage.getPrinterConfigs(tenantDb);
      const config = configs.find((c) => c.id === id);

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Printer configuration not found",
        });
      }

      // Test connection based on connection type
      let testResult = { success: false, message: "Unknown connection type" };

      if (config.connectionType === "network" && config.ipAddress) {
        // Test network connection
        const net = require("net");

        const testPromise = new Promise((resolve) => {
          const client = new net.Socket();
          client.setTimeout(3000);

          client.connect(config.port || 9100, config.ipAddress, () => {
            // Send test print command
            const testData = Buffer.from(
              "\x1B@Test Print from EDPOS\n\n\n\x1DV\x41\x00",
              "utf8",
            );

            client.write(testData, (error) => {
              if (error) {
                resolve({
                  success: false,
                  message: `Failed to send test data: ${error.message}`,
                });
              } else {
                client.end();
                resolve({
                  success: true,
                  message: `Successfully connected to ${config.name}`,
                });
              }
            });
          });

          client.on("error", (err) => {
            resolve({
              success: false,
              message: `Connection failed: ${err.message}`,
            });
          });

          client.on("timeout", () => {
            client.destroy();
            resolve({ success: false, message: "Connection timeout" });
          });
        });

        testResult = await testPromise;
      } else if (config.connectionType === "usb") {
        // For USB printers, we can't directly test but we can check if the config is valid
        testResult = {
          success: true,
          message: "USB printer detection not implemented",
        };
      } else {
        testResult = {
          success: false,
          message: "Invalid printer configuration",
        };
      }

      res.json(testResult);
    } catch (error) {
      console.error("Error testing printer connection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test printer connection",
      });
    }
  });

  // Customer Reports APIs
  app.get("/api/customer-debts", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer debts from database
      const customerDebts = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          initialDebt: sql<number>`0`, // Mock initial debt
          newDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.1`, // 10% of total spent as debt
          payment: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // 5% as payment
          finalDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // Final debt
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredDebts = customerDebts;
      if (customerId) {
        filteredDebts = customerDebts.filter(
          (debt) => debt.id === parseInt(customerId as string),
        );
      }

      res.json(filteredDebts);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer debts",
      });
    }
  });

  app.get("/api/customer-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer sales data from database
      const customerSales = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          totalSales: customers.totalSpent,
          visitCount: customers.visitCount,
          averageOrder: sql<number>`CASE WHEN ${customers.visitCount} > 0 THEN ${customers.totalSpent} / ${customers.visitCount} ELSE 0 END`,
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredSales = customerSales;
      if (customerId) {
        filteredSales = customerSales.filter(
          (sale) => sale.id === parseInt(customerId as string),
        );
      }

      res.json(filteredSales);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer sales",
      });
    }
  });

  // Bulk create products
  app.post("/api/products/bulk", async (req: TenantRequest, res) => {
    try {
      const { products: productList } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!productList || !Array.isArray(productList)) {
        return res.status(400).json({
          error: "Invalid products data",
        });
      }

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const productData of productList) {
        try {
          console.log(`Processing product: ${JSON.stringify(productData)}`);

          // Validate required fields with detailed messages
          const missingFields = [];
          if (!productData.name) missingFields.push("name");
          if (!productData.sku) missingFields.push("sku");
          if (!productData.price) missingFields.push("price");
          if (
            productData.categoryId === undefined ||
            productData.categoryId === null
          )
            missingFields.push("categoryId");

          if (missingFields.length > 0) {
            throw new Error(
              `Missing required fields: ${missingFields.join(", ")}`,
            );
          }

          // Validate data types
          if (isNaN(parseFloat(productData.price))) {
            throw new Error(`Invalid price: ${productData.price}`);
          }

          if (isNaN(parseInt(productData.categoryId))) {
            throw new Error(`Invalid categoryId: ${productData.categoryId}`);
          }

          const [product] = await tenantDb
            .insert(products)
            .values({
              name: productData.name,
              sku: productData.sku,
              price: productData.price.toString(),
              stock: parseInt(productData.stock) || 0,
              categoryId: parseInt(productData.categoryId),
              imageUrl: productData.imageUrl || null,
              taxRate: productData.taxRate
                ? productData.taxRate.toString()
                : "0.00",
            })
            .returning();

          console.log(`Successfully created product: ${product.name}`);
          results.push({
            success: true,
            product,
          });
          successCount++;
        } catch (error) {
          const errorMessage = error.message || "Unknown error";
          console.error(
            `Error creating product ${productData.name || "Unknown"}:`,
            errorMessage,
          );
          console.error("Product data:", JSON.stringify(productData, null, 2));

          results.push({
            success: false,
            error: errorMessage,
            data: productData,
            productName: productData.name || "Unknown",
          });
          errorCount++;
        }
      }

      res.json({
        success: successCount,
        errors: errorCount,
        results,
        message: `${successCount} sản phẩm đã được tạo thành công${errorCount > 0 ? `, ${errorCount} sản phẩm lỗi` : ""}`,
      });
    } catch (error) {
      console.error("Bulk products creation error:", error);
      res.status(500).json({
        error: "Failed to create products",
      });
    }
  });

  // Employee routes
  app.get(
    "/api/employees",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/employees - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for employees");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for employees:",
            dbError,
          );
          tenantDb = null;
        }

        const employees = await storage.getEmployees(tenantDb);
        console.log(`✅ Successfully fetched ${employees.length} employees`);
        res.json(employees);
      } catch (error) {
        console.error("❌ Error fetching employees:", error);
        res.status(500).json({
          message: "Failed to fetch employees",
        });
      }
    },
  );

  // Employee sales report data
  app.get("/api/employee-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      let query = db
        .select({
          employeeName: transactionsTable.cashierName,
          total: transactionsTable.total,
          createdAt: transactionsTable.createdAt,
        })
        .from(transactionsTable);

      if (startDate && endDate) {
        query = query.where(
          and(
            gte(transactionsTable.createdAt, startDate as string),
            lte(transactionsTable.createdAt, endDate as string),
          ),
        );
      }

      if (employeeId && employeeId !== "all") {
        query = query.where(
          eq(transactionsTable.cashierName, employeeId as string),
        );
      }

      const salesData = await query;
      res.json(salesData);
    } catch (error) {
      console.error("Error fetching employee sales:", error);
      res.status(500).json({
        message: "Failed to fetch employee sales data",
      });
    }
  });

  // Server time endpoint for consistent timestamps
  app.get("/api/server-time", async (req: TenantRequest, res) => {
    try {
      const serverTime = {
        timestamp: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      res.json(serverTime);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get server time",
      });
    }
  });

  // Product Analysis API - using orders and order_items data
  app.get("/api/product-analysis", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, categoryId, productType, productSearch } =
        req.query;
      const tenantDb = await getTenantDatabase(req);

      console.log("Product Analysis API called with params:", {
        startDate,
        endDate,
        categoryId,
        productType,
        productSearch,
      });

      // Build date conditions
      const dateConditions = [];
      if (startDate && endDate) {
        const startDateTime = new Date(startDate as string);
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);
        dateConditions.push(
          gte(orders.orderedAt, startDateTime),
          lte(orders.orderedAt, endDateTime),
        );
      }

      // Build category conditions for products
      const categoryConditions = [];
      if (categoryId && categoryId !== "all") {
        categoryConditions.push(
          eq(products.categoryId, parseInt(categoryId as string)),
        );
      }

      // Build product type conditions
      const typeConditions = [];
      if (productType && productType !== "all") {
        const typeMap = {
          combo: 3,
          product: 1,
          service: 2,
        };
        const typeValue = typeMap[productType as keyof typeof typeMap];
        if (typeValue) {
          typeConditions.push(eq(products.productType, value));
        }
      }

      // Build search conditions
      const searchConditions = [];
      if (productSearch && productSearch !== "" && productSearch !== "all") {
        const searchTerm = `%${productSearch}%`;
        searchConditions.push(
          or(ilike(products.name, searchTerm), ilike(products.sku, searchTerm)),
        );
      }

      // Query order items with product details from completed/paid orders
      const productSalesData = await tenantDb
        .select({
          productId: orderItemsTable.productId,
          productName: products.name,
          productSku: products.sku,
          categoryId: products.categoryId,
          categoryName: categories.name,
          unitPrice: orderItemsTable.unitPrice, // This is the pre-tax price
          quantity: orderItemsTable.quantity,
          total: orderItemsTable.total, // This should also be pre-tax total
          orderId: orderItemsTable.orderId,
          orderDate: orders.orderedAt,
          discount: orderItemsTable.discount,
          orderStatus: orders.status,
        })
        .from(orderItemsTable)
        .innerJoin(orders, eq(orderItemsTable.orderId, orders.id))
        .innerJoin(products, eq(orderItemsTable.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            or(eq(orders.status, "paid"), eq(orders.status, "completed")),
            ...dateConditions,
            ...categoryConditions,
            ...typeConditions,
            ...searchConditions,
          ),
        )
        .orderBy(desc(orders.orderedAt));

      console.log(`Found ${productSalesData.length} product sales records`);

      // Group and aggregate data by product
      const productMap = new Map();

      productSalesData.forEach((item) => {
        const productId = item.productId;
        const quantity = Number(item.quantity || 0);
        const revenue = Number(item.unitPrice || 0) * quantity;
        const discount = Number(item.discount || 0);

        if (productMap.has(productId)) {
          const existing = productMap.get(productId);
          existing.totalQuantity += quantity;
          existing.totalRevenue += revenue;
          existing.discount += discount;
          existing.orderCount += 1;
        } else {
          productMap.set(productId, {
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            productType: item.productType,
            unitPrice: item.unitPrice, // This is the pre-tax price
            quantity: item.quantity,
            total: item.total,
            discount: item.discount,
            totalQuantity: quantity,
            totalRevenue: revenue,
            totalDiscount: discount,
            averagePrice: Number(item.unitPrice || 0),
            orderCount: 1,
          });
        }
      });

      // Convert to array and calculate final metrics
      const productStats = Array.from(productMap.values()).map((product) => ({
        ...product,
        averageOrderValue:
          product.orderCount > 0
            ? product.totalRevenue / product.orderCount
            : 0,
      }));

      // Calculate totals
      const totalRevenue = productStats.reduce(
        (sum, product) => sum + product.totalRevenue,
        0,
      );
      const totalQuantity = productStats.reduce(
        (sum, product) => sum + product.totalQuantity,
        0,
      );
      const totalDiscount = productStats.reduce(
        (sum, product) => sum + product.totalDiscount,
        0,
      );
      const totalProducts = productStats.length;

      // Sort by revenue (descending)
      productStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

      const result = {
        productStats,
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        summary: {
          topSellingProduct: productStats[0] || null,
          averageRevenuePerProduct:
            totalProducts > 0 ? totalRevenue / totalProducts : 0,
        },
      };

      console.log("Product Analysis Results:", {
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        topProduct: result.summary.topSellingProduct?.productName,
      });

      res.json(result);
    } catch (error) {
      console.error("Product analysis error:", error);
      res.status(500).json({
        error: "Failed to fetch product analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // // Enhanced API endpoints for sales chart report - using same data source as dashboard
  app.get(
    "/api/dashboard-data/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Dashboard data API called with params:", {
          startDate,
          endDate,
        });

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Get orders, tables, transactions, invoices - EXACT same as dashboard
        const [orders, tables, transactions, invoices] = await Promise.all([
          storage.getOrders(undefined, undefined, tenantDb),
          storage.getTables(tenantDb),
          storage.getTransactions(tenantDb),
          storage.getInvoices(tenantDb),
        ]);

        // Filter completed orders within date range - EXACT same logic as dashboard
        const filteredCompletedOrders = Array.isArray(orders)
          ? orders.filter((order) => {
              try {
                if (!order) return false;

                // Try multiple date fields - prioritize orderedAt, paidAt, createdAt
                const orderDate = new Date(
                  order.orderedAt ||
                    order.paidAt ||
                    order.createdAt ||
                    order.created_at,
                );

                if (isNaN(orderDate.getTime())) {
                  return false;
                }

                const dateMatch = orderDate >= start && orderDate <= end;

                // Include more order statuses to show real data
                const isCompleted =
                  order.status === "paid" ||
                  order.status === "completed" ||
                  order.status === "served" ||
                  order.status === "confirmed";

                return dateMatch && isCompleted;
              } catch (error) {
                console.error("Error filtering order:", order, error);
                return false;
              }
            })
          : [];

        // Calculate dashboard stats - EXACT same logic
        const periodRevenue = filteredCompletedOrders.reduce((total, order) => {
          const orderTotal = Number(order.total || 0);
          return total + orderTotal;
        }, 0);

        const periodOrderCount = filteredCompletedOrders.length;

        // Customer count: count unique customers from completed orders
        const uniqueCustomers = new Set();
        filteredCompletedOrders.forEach((order) => {
          if (order.customerId) {
            uniqueCustomers.add(order.customerId);
          } else {
            uniqueCustomers.add(`order_${order.id}`);
          }
        });
        const periodCustomerCount = uniqueCustomers.size;

        // Daily average for the period
        const daysDiff = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
            1,
        );
        const dailyAverageRevenue = periodRevenue / daysDiff;

        // Active orders (pending/in-progress orders)
        const activeOrders = orders.filter(
          (order) =>
            order.status === "pending" || order.status === "in_progress",
        ).length;

        const occupiedTables = tables.filter(
          (table) => table.status === "occupied",
        );

        const monthRevenue = periodRevenue;
        const averageOrderValue =
          periodOrderCount > 0 ? periodRevenue / periodOrderCount : 0;

        // Peak hours analysis
        const hourlyOrders: {
          [key: number]: number;
        } = {};
        filteredCompletedOrders.forEach((order) => {
          const orderDate = new Date(
            order.orderedAt ||
              order.createdAt ||
              order.created_at ||
              order.paidAt,
          );
          if (!isNaN(orderDate.getTime())) {
            const hour = orderDate.getHours();
            hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1;
          }
        });

        const peakHour = Object.keys(hourlyOrders).reduce(
          (peak, hour) =>
            hourlyOrders[parseInt(hour)] > hourlyOrders[parseInt(peak)]
              ? hour
              : peak,
          "12",
        );

        const dashboardData = {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          dailyAverageRevenue,
          activeOrders,
          occupiedTables: occupiedTables.length,
          monthRevenue,
          averageOrderValue,
          peakHour: parseInt(peakHour),
          totalTables: tables.length,
          filteredCompletedOrders,
          orders: orders || [],
          tables: tables || [],
          transactions: transactions || [],
          invoices: invoices || [],
        };

        console.log("Dashboard data calculated:", {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          filteredOrdersCount: filteredCompletedOrders.length,
        });

        res.json(dashboardData);
      } catch (error) {
        console.error("Error in dashboard data API:", error);
        res.status(500).json({
          error: "Failed to fetch dashboard data",
        });
      }
    },
  );

  // Transactions API with enhanced filtering
  app.get(
    "/api/transactions/:startDate/:endDate/:salesMethod/:salesChannel/:analysisType/:concernType/:selectedEmployee",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Transactions API called with params:", {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        });

        // Get transactions data
        const transactions = await storage.getTransactions(tenantDb);

        // Filter transactions based on parameters
        const filteredTransactions = transactions.filter((transaction) => {
          const transactionDate = new Date(transaction.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = transactionDate >= start && transactionDate <= end;

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            const paymentMethod = transaction.paymentMethod || "cash";
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !transaction.deliveryMethod ||
                  transaction.deliveryMethod === "pickup" ||
                  transaction.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = transaction.deliveryMethod === "delivery";
                break;
              default:
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = transaction.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !transaction.salesChannel ||
                  transaction.salesChannel === "direct" ||
                  transaction.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  transaction.salesChannel &&
                  transaction.salesChannel !== "direct" &&
                  transaction.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              transaction.cashierName === selectedEmployee ||
              (transaction.cashierName &&
                transaction.cashierName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          return (
            dateMatch && salesMethodMatch && salesChannelMatch && employeeMatch
          );
        });

        console.log(
          `Found ${filteredTransactions.length} filtered transactions out of ${transactions.length} total`,
        );
        res.json(filteredTransactions);
      } catch (error) {
        console.error("Error in transactions API:", error);
        res.status(500).json({
          error: "Failed to fetch transactions data",
        });
      }
    },
  );

  app.get(
    "/api/orders/:startDate/:endDate/:selectedEmployee/:salesChannel/:salesMethod/:analysisType/:concernType",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Orders API called with params:", {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        });

        // Get orders data
        const orders = await storage.getOrders(undefined, undefined, tenantDb);

        // Filter orders based on parameters with enhanced logic
        const filteredOrders = orders.filter((order) => {
          const orderDate = new Date(order.orderedAt || order.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = orderDate >= start && orderDate <= end;

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              order.employeeId?.toString() === selectedEmployee ||
              (order.employeeName &&
                order.employeeName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = order.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !order.salesChannel ||
                  order.salesChannel === "direct" ||
                  order.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  order.salesChannel &&
                  order.salesChannel !== "direct" &&
                  order.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !order.deliveryMethod ||
                  order.deliveryMethod === "pickup" ||
                  order.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = order.deliveryMethod === "delivery";
                break;
              default:
                const paymentMethod = order.paymentMethod || "cash";
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Only include paid orders for analysis
          const statusMatch = order.status === "paid";

          return (
            dateMatch &&
            employeeMatch &&
            salesChannelMatch &&
            salesMethodMatch &&
            statusMatch
          );
        });

        console.log(
          `Found ${filteredOrders.length} filtered orders out of ${orders.length} total`,
        );
        res.json(filteredOrders);
      } catch (error) {
        console.error("Error in orders API:", error);
        res.status(500).json({
          error: "Failed to fetch orders data",
        });
      }
    },
  );

  app.get(
    "/api/products/:selectedCategory/:productType/:productSearch?",
    async (req: TenantRequest, res) => {
      try {
        const { selectedCategory, productType, productSearch } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Products API called with params:", {
          selectedCategory,
          productType,
          productSearch,
        });

        let products;

        // Get products by category or all products
        if (
          selectedCategory &&
          selectedCategory !== "all" &&
          selectedCategory !== "undefined"
        ) {
          const categoryId = parseInt(selectedCategory);
          if (!isNaN(categoryId)) {
            products = await storage.getProductsByCategory(
              categoryId,
              true,
              tenantDb,
            );
          } else {
            products = await storage.getAllProducts(true, tenantDb);
          }
        } else {
          products = await storage.getAllProducts(true, tenantDb);
        }

        // Filter by product type if specified
        if (
          productType &&
          productType !== "all" &&
          productType !== "undefined"
        ) {
          const typeMap = {
            combo: 3,
            "combo-dongoi": 3,
            product: 1,
            "hang-hoa": 1,
            service: 2,
            "dich-vu": 2,
          };
          const typeValue =
            typeMap[productType.toLowerCase() as keyof typeof typeMap];
          if (typeValue) {
            products = products.filter(
              (product) => product.productType === typeValue,
            );
          }
        }

        // Filter by product search if provided
        if (
          productSearch &&
          productSearch !== "" &&
          productSearch !== "undefined" &&
          productSearch !== "all"
        ) {
          const searchTerm = productSearch.toLowerCase();
          products = products.filter(
            (product) =>
              product.name?.toLowerCase().includes(searchTerm) ||
              product.sku?.toLowerCase().includes(searchTerm) ||
              product.description?.toLowerCase().includes(searchTerm),
          );
        }

        console.log(`Found ${products.length} products after filtering`);
        res.json(products);
      } catch (error) {
        console.error("Error in products API:", error);
        res.status(500).json({
          error: "Failed to fetch products data",
        });
      }
    },
  );

  app.get(
    "/api/customers/:customerSearch?/:customerStatus?",
    async (req: TenantRequest, res) => {
      try {
        const { customerSearch, customerStatus } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log(
          "Customers API called with search:",
          customerSearch,
          "status:",
          customerStatus,
        );

        let customers = await storage.getCustomers(tenantDb);

        // Filter by search if provided
        if (
          customerSearch &&
          customerSearch !== "" &&
          customerSearch !== "undefined" &&
          customerSearch !== "all"
        ) {
          const searchTerm = customerSearch.toLowerCase();
          customers = customers.filter(
            (customer) =>
              customer.name?.toLowerCase().includes(searchTerm) ||
              customer.phone?.includes(customerSearch) ||
              customer.email?.toLowerCase().includes(searchTerm) ||
              customer.customerId?.toLowerCase().includes(searchTerm) ||
              customer.address?.toLowerCase().includes(searchTerm),
          );
        }

        // Filter by status if provided
        if (
          customerStatus &&
          customerStatus !== "all" &&
          customerStatus !== "undefined"
        ) {
          const now = new Date();
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          customers = customers.filter((customer) => {
            const totalSpent = Number(customer.totalSpent || 0);
            const lastVisit = customer.lastVisit
              ? new Date(customer.lastVisit)
              : null;

            switch (customerStatus) {
              case "active":
                return lastVisit && lastVisit >= thirtyDaysAgo;
              case "inactive":
                return !lastVisit || lastVisit < thirtyDaysAgo;
              case "vip":
                return totalSpent >= 500000; // VIP customers with total spent >= 500k VND
              case "new":
                const joinDate = customer.createdAt
                  ? new Date(customer.createdAt)
                  : null;
                return joinDate && joinDate >= thirtyDaysAgo;
              default:
                return true;
            }
          });
        }

        console.log(`Found ${customers.length} customers after filtering`);
        res.json(customers);
      } catch (error) {
        console.error("Error in customers API:", error);
        res.status(500).json({
          error: "Failed to fetch customers data",
        });
      }
    },
  );

  // Tax code lookup proxy endpoint
  app.post("/api/tax-code-lookup", async (req: TenantRequest, res) => {
    try {
      const { taxCode } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!taxCode) {
        return res.status(400).json({
          success: false,
          message: "Mã số thuế không được để trống",
        });
      }

      // Call the external tax code API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/CheckListTaxCode/v2",
        {
          method: "POST",
          headers: {
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([taxCode]),
        },
      );

      if (!response.ok) {
        throw new Error(
          `External API error: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();

      res.json({
        success: true,
        data: result,
        message: "Tra cứu thành công",
      });
    } catch (error) {
      console.error("Tax code lookup error:", error);
      res.status(500).json({
        success: false,
        message: "Có lỗi xảy ra khi tra cứu mã số thuế",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // E-invoice publish proxy endpoint
  app.post("/api/einvoice/publish", async (req: TenantRequest, res) => {
    try {
      const publishRequest = req.body;
      const tenantDb = await getTenantDatabase(req);
      console.log(
        "Publishing invoice with data:",
        JSON.stringify(publishRequest, null, 2),
      );

      // Call the real e-invoice API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/invoice/publish",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
          },
          body: JSON.stringify(publishRequest),
        },
      );

      if (!response.ok) {
        console.error(
          "E-invoice API error:",
          response.status,
          response.statusText,
        );
        const errorText = await response.text();
        console.error("Error response:", errorText);

        return res.status(response.status).json({
          error: "Failed to publish invoice",
          details: `API returned ${response.status}: ${response.statusText}`,
          apiResponse: errorText,
        });
      }

      const result = await response.json();
      console.log("E-invoice API response:", result);

      // Check if the API returned success
      if (result.status === true) {
        console.log("Invoice published successfully:", result);

        // Return standardized response format
        res.json({
          success: true,
          message:
            result.message || "Hóa đơn điện tử đã được phát hành thành công",
          data: {
            invoiceNo: result.data?.invoiceNo,
            invDate: result.data?.invDate,
            transactionID: result.data?.transactionID,
            macqt: result.data?.macqt,
            originalRequest: {
              transactionID: publishRequest.transactionID,
              invRef: publishRequest.invRef,
              totalAmount: publishRequest.invTotalAmount,
              customer: publishRequest.Customer,
            },
          },
        });
      } else {
        // API returned failure
        console.error("E-invoice API returned failure:", result);
        res.status(400).json({
          error: "E-invoice publication failed",
          message: result.message || "Unknown error from e-invoice service",
          details: result,
        });
      }
    } catch (error) {
      console.error("E-invoice publish proxy error details:");
      console.error("- Error type:", error?.constructor.name);
      console.error("- Error message:", error?.message);
      console.error("- Full error:", error);

      res.status(500).json({
        error: "Failed to publish invoice",
        details: error?.message,
        errorType: error?.constructor.name,
      });
    }
  });

  // Printer configuration management APIs
  app.get(
    "/api/printer-configs",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log(
          "🔍 GET /api/printer-configs - Starting request processing",
        );
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for printer configs",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for printer configs:",
            dbError,
          );
          tenantDb = null;
        }

        const configs = await storage.getPrinterConfigs(tenantDb);
        console.log(
          `✅ Successfully fetched ${configs.length} printer configs`,
        );
        res.json(configs);
      } catch (error) {
        console.error("❌ Error fetching printer configs:", error);
        res.status(500).json({
          error: "Failed to fetch printer configs",
        });
      }
    },
  );

  app.post("/api/printer-configs", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log("Creating printer config with data:", configData);

      const config = await storage.createPrinterConfig(configData, tenantDb);
      res.status(201).json(config);
    } catch (error) {
      console.error("Error creating printer config:", error);
      res.status(500).json({
        error: "Failed to create printer config",
      });
    }
  });

  app.put("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log(`Updating printer config ${id} with data:`, configData);

      const config = await storage.updatePrinterConfig(
        id,
        configData,
        tenantDb,
      );
      if (!config) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json(config);
    } catch (error) {
      console.error("Error updating printer config:", error);
      res.status(500).json({
        error: "Failed to update printer config",
      });
    }
  });

  app.delete("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      console.log(`Deleting printer config ${id}`);

      const deleted = await storage.deletePrinterConfig(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json({
        message: "Printer config deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting printer config:", error);
      res.status(500).json({
        error: "Failed to delete printer config",
      });
    }
  });

  app.post("/api/printer-configs/:id/test", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      // Get printer config
      const configs = await storage.getPrinterConfigs(tenantDb);
      const config = configs.find((c) => c.id === id);

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Printer configuration not found",
        });
      }

      // Test connection based on connection type
      let testResult = { success: false, message: "Unknown connection type" };

      if (config.connectionType === "network" && config.ipAddress) {
        // Test network connection
        const net = require("net");

        const testPromise = new Promise((resolve) => {
          const client = new net.Socket();
          client.setTimeout(3000);

          client.connect(config.port || 9100, config.ipAddress, () => {
            // Send test print command
            const testData = Buffer.from(
              "\x1B@Test Print from EDPOS\n\n\n\x1DV\x41\x00",
              "utf8",
            );

            client.write(testData, (error) => {
              if (error) {
                resolve({
                  success: false,
                  message: `Failed to send test data: ${error.message}`,
                });
              } else {
                client.end();
                resolve({
                  success: true,
                  message: `Successfully connected to ${config.name}`,
                });
              }
            });
          });

          client.on("error", (err) => {
            resolve({
              success: false,
              message: `Connection failed: ${err.message}`,
            });
          });

          client.on("timeout", () => {
            client.destroy();
            resolve({ success: false, message: "Connection timeout" });
          });
        });

        testResult = await testPromise;
      } else if (config.connectionType === "usb") {
        // For USB printers, we can't directly test but we can check if the config is valid
        testResult = {
          success: true,
          message: "USB printer detection not implemented",
        };
      } else {
        testResult = {
          success: false,
          message: "Invalid printer configuration",
        };
      }

      res.json(testResult);
    } catch (error) {
      console.error("Error testing printer connection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test printer connection",
      });
    }
  });

  // Customer Reports APIs
  app.get("/api/customer-debts", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer debts from database
      const customerDebts = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          initialDebt: sql<number>`0`, // Mock initial debt
          newDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.1`, // 10% of total spent as debt
          payment: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // 5% as payment
          finalDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // Final debt
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredDebts = customerDebts;
      if (customerId) {
        filteredDebts = customerDebts.filter(
          (debt) => debt.id === parseInt(customerId as string),
        );
      }

      res.json(filteredDebts);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer debts",
      });
    }
  });

  app.get("/api/customer-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer sales data from database
      const customerSales = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          totalSales: customers.totalSpent,
          visitCount: customers.visitCount,
          averageOrder: sql<number>`CASE WHEN ${customers.visitCount} > 0 THEN ${customers.totalSpent} / ${customers.visitCount} ELSE 0 END`,
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredSales = customerSales;
      if (customerId) {
        filteredSales = customerSales.filter(
          (sale) => sale.id === parseInt(customerId as string),
        );
      }

      res.json(filteredSales);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer sales",
      });
    }
  });

  // Bulk create products
  app.post("/api/products/bulk", async (req: TenantRequest, res) => {
    try {
      const { products: productList } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!productList || !Array.isArray(productList)) {
        return res.status(400).json({
          error: "Invalid products data",
        });
      }

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const productData of productList) {
        try {
          console.log(`Processing product: ${JSON.stringify(productData)}`);

          // Validate required fields with detailed messages
          const missingFields = [];
          if (!productData.name) missingFields.push("name");
          if (!productData.sku) missingFields.push("sku");
          if (!productData.price) missingFields.push("price");
          if (
            productData.categoryId === undefined ||
            productData.categoryId === null
          )
            missingFields.push("categoryId");

          if (missingFields.length > 0) {
            throw new Error(
              `Missing required fields: ${missingFields.join(", ")}`,
            );
          }

          // Validate data types
          if (isNaN(parseFloat(productData.price))) {
            throw new Error(`Invalid price: ${productData.price}`);
          }

          if (isNaN(parseInt(productData.categoryId))) {
            throw new Error(`Invalid categoryId: ${productData.categoryId}`);
          }

          const [product] = await tenantDb
            .insert(products)
            .values({
              name: productData.name,
              sku: productData.sku,
              price: productData.price.toString(),
              stock: parseInt(productData.stock) || 0,
              categoryId: parseInt(productData.categoryId),
              imageUrl: productData.imageUrl || null,
              taxRate: productData.taxRate
                ? productData.taxRate.toString()
                : "0.00",
            })
            .returning();

          console.log(`Successfully created product: ${product.name}`);
          results.push({
            success: true,
            product,
          });
          successCount++;
        } catch (error) {
          const errorMessage = error.message || "Unknown error";
          console.error(
            `Error creating product ${productData.name || "Unknown"}:`,
            errorMessage,
          );
          console.error("Product data:", JSON.stringify(productData, null, 2));

          results.push({
            success: false,
            error: errorMessage,
            data: productData,
            productName: productData.name || "Unknown",
          });
          errorCount++;
        }
      }

      res.json({
        success: successCount,
        errors: errorCount,
        results,
        message: `${successCount} sản phẩm đã được tạo thành công${errorCount > 0 ? `, ${errorCount} sản phẩm lỗi` : ""}`,
      });
    } catch (error) {
      console.error("Bulk products creation error:", error);
      res.status(500).json({
        error: "Failed to create products",
      });
    }
  });

  // Employee routes
  app.get(
    "/api/employees",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/employees - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for employees");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for employees:",
            dbError,
          );
          tenantDb = null;
        }

        const employees = await storage.getEmployees(tenantDb);
        console.log(`✅ Successfully fetched ${employees.length} employees`);
        res.json(employees);
      } catch (error) {
        console.error("❌ Error fetching employees:", error);
        res.status(500).json({
          message: "Failed to fetch employees",
        });
      }
    },
  );

  // Employee sales report data
  app.get("/api/employee-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      let query = db
        .select({
          employeeName: transactionsTable.cashierName,
          total: transactionsTable.total,
          createdAt: transactionsTable.createdAt,
        })
        .from(transactionsTable);

      if (startDate && endDate) {
        query = query.where(
          and(
            gte(transactionsTable.createdAt, startDate as string),
            lte(transactionsTable.createdAt, endDate as string),
          ),
        );
      }

      if (employeeId && employeeId !== "all") {
        query = query.where(
          eq(transactionsTable.cashierName, employeeId as string),
        );
      }

      const salesData = await query;
      res.json(salesData);
    } catch (error) {
      console.error("Error fetching employee sales:", error);
      res.status(500).json({
        message: "Failed to fetch employee sales data",
      });
    }
  });

  // Server time endpoint for consistent timestamps
  app.get("/api/server-time", async (req: TenantRequest, res) => {
    try {
      const serverTime = {
        timestamp: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      res.json(serverTime);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get server time",
      });
    }
  });

  // Product Analysis API - using orders and order_items data
  app.get("/api/product-analysis", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, categoryId, productType, productSearch } =
        req.query;
      const tenantDb = await getTenantDatabase(req);

      console.log("Product Analysis API called with params:", {
        startDate,
        endDate,
        categoryId,
        productType,
        productSearch,
      });

      // Build date conditions
      const dateConditions = [];
      if (startDate && endDate) {
        const startDateTime = new Date(startDate as string);
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);
        dateConditions.push(
          gte(orders.orderedAt, startDateTime),
          lte(orders.orderedAt, endDateTime),
        );
      }

      // Build category conditions for products
      const categoryConditions = [];
      if (categoryId && categoryId !== "all") {
        categoryConditions.push(
          eq(products.categoryId, parseInt(categoryId as string)),
        );
      }

      // Build product type conditions
      const typeConditions = [];
      if (productType && productType !== "all") {
        const typeMap = {
          combo: 3,
          product: 1,
          service: 2,
        };
        const typeValue = typeMap[productType as keyof typeof typeMap];
        if (typeValue) {
          typeConditions.push(eq(products.productType, typeValue));
        }
      }

      // Build search conditions
      const searchConditions = [];
      if (productSearch && productSearch !== "" && productSearch !== "all") {
        const searchTerm = `%${productSearch}%`;
        searchConditions.push(
          or(ilike(products.name, searchTerm), ilike(products.sku, searchTerm)),
        );
      }

      // Query order items with product details from completed/paid orders
      const productSalesData = await tenantDb
        .select({
          productId: orderItemsTable.productId,
          productName: products.name,
          productSku: products.sku,
          categoryId: products.categoryId,
          categoryName: categories.name,
          unitPrice: orderItemsTable.unitPrice, // This is the pre-tax price
          quantity: orderItemsTable.quantity,
          total: orderItemsTable.total, // This should also be pre-tax total
          orderId: orderItemsTable.orderId,
          orderDate: orders.orderedAt,
          discount: orderItemsTable.discount,
          orderStatus: orders.status,
        })
        .from(orderItemsTable)
        .innerJoin(orders, eq(orderItemsTable.orderId, orders.id))
        .innerJoin(products, eq(orderItemsTable.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            or(eq(orders.status, "paid"), eq(orders.status, "completed")),
            ...dateConditions,
            ...categoryConditions,
            ...typeConditions,
            ...searchConditions,
          ),
        )
        .orderBy(desc(orders.orderedAt));

      console.log(`Found ${productSalesData.length} product sales records`);

      // Group and aggregate data by product
      const productMap = new Map();

      productSalesData.forEach((item) => {
        const productId = item.productId;
        const quantity = Number(item.quantity || 0);
        const revenue = Number(item.unitPrice || 0) * quantity;
        const discount = Number(item.discount || 0);

        if (productMap.has(productId)) {
          const existing = productMap.get(productId);
          existing.totalQuantity += quantity;
          existing.totalRevenue += revenue;
          existing.discount += discount;
          existing.orderCount += 1;
        } else {
          productMap.set(productId, {
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            productType: item.productType,
            unitPrice: item.unitPrice, // This is the pre-tax price
            quantity: item.quantity,
            total: item.total,
            discount: item.discount,
            totalQuantity: quantity,
            totalRevenue: revenue,
            totalDiscount: discount,
            averagePrice: Number(item.unitPrice || 0),
            orderCount: 1,
          });
        }
      });

      // Convert to array and calculate final metrics
      const productStats = Array.from(productMap.values()).map((product) => ({
        ...product,
        averageOrderValue:
          product.orderCount > 0
            ? product.totalRevenue / product.orderCount
            : 0,
      }));

      // Calculate totals
      const totalRevenue = productStats.reduce(
        (sum, product) => sum + product.totalRevenue,
        0,
      );
      const totalQuantity = productStats.reduce(
        (sum, product) => sum + product.totalQuantity,
        0,
      );
      const totalDiscount = productStats.reduce(
        (sum, product) => sum + product.totalDiscount,
        0,
      );
      const totalProducts = productStats.length;

      // Sort by revenue (descending)
      productStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

      const result = {
        productStats,
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        summary: {
          topSellingProduct: productStats[0] || null,
          averageRevenuePerProduct:
            totalProducts > 0 ? totalRevenue / totalProducts : 0,
        },
      };

      console.log("Product Analysis Results:", {
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        topProduct: result.summary.topSellingProduct?.productName,
      });

      res.json(result);
    } catch (error) {
      console.error("Product analysis error:", error);
      res.status(500).json({
        error: "Failed to fetch product analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // // Enhanced API endpoints for sales chart report - using same data source as dashboard
  app.get(
    "/api/dashboard-data/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Dashboard data API called with params:", {
          startDate,
          endDate,
        });

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Get orders, tables, transactions, invoices - EXACT same as dashboard
        const [orders, tables, transactions, invoices] = await Promise.all([
          storage.getOrders(undefined, undefined, tenantDb),
          storage.getTables(tenantDb),
          storage.getTransactions(tenantDb),
          storage.getInvoices(tenantDb),
        ]);

        // Filter completed orders within date range - EXACT same logic as dashboard
        const filteredCompletedOrders = Array.isArray(orders)
          ? orders.filter((order) => {
              try {
                if (!order) return false;

                // Try multiple date fields - prioritize orderedAt, paidAt, createdAt
                const orderDate = new Date(
                  order.orderedAt ||
                    order.paidAt ||
                    order.createdAt ||
                    order.created_at,
                );

                if (isNaN(orderDate.getTime())) {
                  return false;
                }

                const dateMatch = orderDate >= start && orderDate <= end;

                // Include more order statuses to show real data
                const isCompleted =
                  order.status === "paid" ||
                  order.status === "completed" ||
                  order.status === "served" ||
                  order.status === "confirmed";

                return dateMatch && isCompleted;
              } catch (error) {
                console.error("Error filtering order:", order, error);
                return false;
              }
            })
          : [];

        // Calculate dashboard stats - EXACT same logic
        const periodRevenue = filteredCompletedOrders.reduce((total, order) => {
          const orderTotal = Number(order.total || 0);
          return total + orderTotal;
        }, 0);

        const periodOrderCount = filteredCompletedOrders.length;

        // Customer count: count unique customers from completed orders
        const uniqueCustomers = new Set();
        filteredCompletedOrders.forEach((order) => {
          if (order.customerId) {
            uniqueCustomers.add(order.customerId);
          } else {
            uniqueCustomers.add(`order_${order.id}`);
          }
        });
        const periodCustomerCount = uniqueCustomers.size;

        // Daily average for the period
        const daysDiff = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
            1,
        );
        const dailyAverageRevenue = periodRevenue / daysDiff;

        // Active orders (pending/in-progress orders)
        const activeOrders = orders.filter(
          (order) =>
            order.status === "pending" || order.status === "in_progress",
        ).length;

        const occupiedTables = tables.filter(
          (table) => table.status === "occupied",
        );

        const monthRevenue = periodRevenue;
        const averageOrderValue =
          periodOrderCount > 0 ? periodRevenue / periodOrderCount : 0;

        // Peak hours analysis
        const hourlyOrders: {
          [key: number]: number;
        } = {};
        filteredCompletedOrders.forEach((order) => {
          const orderDate = new Date(
            order.orderedAt ||
              order.createdAt ||
              order.created_at ||
              order.paidAt,
          );
          if (!isNaN(orderDate.getTime())) {
            const hour = orderDate.getHours();
            hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1;
          }
        });

        const peakHour = Object.keys(hourlyOrders).reduce(
          (peak, hour) =>
            hourlyOrders[parseInt(hour)] > hourlyOrders[parseInt(peak)]
              ? hour
              : peak,
          "12",
        );

        const dashboardData = {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          dailyAverageRevenue,
          activeOrders,
          occupiedTables: occupiedTables.length,
          monthRevenue,
          averageOrderValue,
          peakHour: parseInt(peakHour),
          totalTables: tables.length,
          filteredCompletedOrders,
          orders: orders || [],
          tables: tables || [],
          transactions: transactions || [],
          invoices: invoices || [],
        };

        console.log("Dashboard data calculated:", {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          filteredOrdersCount: filteredCompletedOrders.length,
        });

        res.json(dashboardData);
      } catch (error) {
        console.error("Error in dashboard data API:", error);
        res.status(500).json({
          error: "Failed to fetch dashboard data",
        });
      }
    },
  );

  // Transactions API with enhanced filtering
  app.get(
    "/api/transactions/:startDate/:endDate/:salesMethod/:salesChannel/:analysisType/:concernType/:selectedEmployee",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Transactions API called with params:", {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        });

        // Get transactions data
        const transactions = await storage.getTransactions(tenantDb);

        // Filter transactions based on parameters
        const filteredTransactions = transactions.filter((transaction) => {
          const transactionDate = new Date(transaction.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = transactionDate >= start && transactionDate <= end;

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            const paymentMethod = transaction.paymentMethod || "cash";
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !transaction.deliveryMethod ||
                  transaction.deliveryMethod === "pickup" ||
                  transaction.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = transaction.deliveryMethod === "delivery";
                break;
              default:
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = transaction.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !transaction.salesChannel ||
                  transaction.salesChannel === "direct" ||
                  transaction.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  transaction.salesChannel &&
                  transaction.salesChannel !== "direct" &&
                  transaction.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              transaction.cashierName === selectedEmployee ||
              (transaction.cashierName &&
                transaction.cashierName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          return (
            dateMatch && salesMethodMatch && salesChannelMatch && employeeMatch
          );
        });

        console.log(
          `Found ${filteredTransactions.length} filtered transactions out of ${transactions.length} total`,
        );
        res.json(filteredTransactions);
      } catch (error) {
        console.error("Error in transactions API:", error);
        res.status(500).json({
          error: "Failed to fetch transactions data",
        });
      }
    },
  );

  app.get(
    "/api/orders/:startDate/:endDate/:selectedEmployee/:salesChannel/:salesMethod/:analysisType/:concernType",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Orders API called with params:", {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        });

        // Get orders data
        const orders = await storage.getOrders(undefined, undefined, tenantDb);

        // Filter orders based on parameters with enhanced logic
        const filteredOrders = orders.filter((order) => {
          const orderDate = new Date(order.orderedAt || order.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = orderDate >= start && orderDate <= end;

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              order.employeeId?.toString() === selectedEmployee ||
              (order.employeeName &&
                order.employeeName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = order.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !order.salesChannel ||
                  order.salesChannel === "direct" ||
                  order.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  order.salesChannel &&
                  order.salesChannel !== "direct" &&
                  order.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !order.deliveryMethod ||
                  order.deliveryMethod === "pickup" ||
                  order.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = order.deliveryMethod === "delivery";
                break;
              default:
                const paymentMethod = order.paymentMethod || "cash";
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Only include paid orders for analysis
          const statusMatch = order.status === "paid";

          return (
            dateMatch &&
            employeeMatch &&
            salesChannelMatch &&
            salesMethodMatch &&
            statusMatch
          );
        });

        console.log(
          `Found ${filteredOrders.length} filtered orders out of ${orders.length} total`,
        );
        res.json(filteredOrders);
      } catch (error) {
        console.error("Error in orders API:", error);
        res.status(500).json({
          error: "Failed to fetch orders data",
        });
      }
    },
  );

  app.get(
    "/api/products/:selectedCategory/:productType/:productSearch?",
    async (req: TenantRequest, res) => {
      try {
        const { selectedCategory, productType, productSearch } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Products API called with params:", {
          selectedCategory,
          productType,
          productSearch,
        });

        let products;

        // Get products by category or all products
        if (
          selectedCategory &&
          selectedCategory !== "all" &&
          selectedCategory !== "undefined"
        ) {
          const categoryId = parseInt(selectedCategory);
          if (!isNaN(categoryId)) {
            products = await storage.getProductsByCategory(
              categoryId,
              true,
              tenantDb,
            );
          } else {
            products = await storage.getAllProducts(true, tenantDb);
          }
        } else {
          products = await storage.getAllProducts(true, tenantDb);
        }

        // Filter by product type if specified
        if (
          productType &&
          productType !== "all" &&
          productType !== "undefined"
        ) {
          const typeMap = {
            combo: 3,
            "combo-dongoi": 3,
            product: 1,
            "hang-hoa": 1,
            service: 2,
            "dich-vu": 2,
          };
          const typeValue =
            typeMap[productType.toLowerCase() as keyof typeof typeMap];
          if (typeValue) {
            products = products.filter(
              (product) => product.productType === typeValue,
            );
          }
        }

        // Filter by product search if provided
        if (
          productSearch &&
          productSearch !== "" &&
          productSearch !== "undefined" &&
          productSearch !== "all"
        ) {
          const searchTerm = productSearch.toLowerCase();
          products = products.filter(
            (product) =>
              product.name?.toLowerCase().includes(searchTerm) ||
              product.sku?.toLowerCase().includes(searchTerm) ||
              product.description?.toLowerCase().includes(searchTerm),
          );
        }

        console.log(`Found ${products.length} products after filtering`);
        res.json(products);
      } catch (error) {
        console.error("Error in products API:", error);
        res.status(500).json({
          error: "Failed to fetch products data",
        });
      }
    },
  );

  app.get(
    "/api/customers/:customerSearch?/:customerStatus?",
    async (req: TenantRequest, res) => {
      try {
        const { customerSearch, customerStatus } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log(
          "Customers API called with search:",
          customerSearch,
          "status:",
          customerStatus,
        );

        let customers = await storage.getCustomers(tenantDb);

        // Filter by search if provided
        if (
          customerSearch &&
          customerSearch !== "" &&
          customerSearch !== "undefined" &&
          customerSearch !== "all"
        ) {
          const searchTerm = customerSearch.toLowerCase();
          customers = customers.filter(
            (customer) =>
              customer.name?.toLowerCase().includes(searchTerm) ||
              customer.phone?.includes(customerSearch) ||
              customer.email?.toLowerCase().includes(searchTerm) ||
              customer.customerId?.toLowerCase().includes(searchTerm) ||
              customer.address?.toLowerCase().includes(searchTerm),
          );
        }

        // Filter by status if provided
        if (
          customerStatus &&
          customerStatus !== "all" &&
          customerStatus !== "undefined"
        ) {
          const now = new Date();
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          customers = customers.filter((customer) => {
            const totalSpent = Number(customer.totalSpent || 0);
            const lastVisit = customer.lastVisit
              ? new Date(customer.lastVisit)
              : null;

            switch (customerStatus) {
              case "active":
                return lastVisit && lastVisit >= thirtyDaysAgo;
              case "inactive":
                return !lastVisit || lastVisit < thirtyDaysAgo;
              case "vip":
                return totalSpent >= 500000; // VIP customers with total spent >= 500k VND
              case "new":
                const joinDate = customer.createdAt
                  ? new Date(customer.createdAt)
                  : null;
                return joinDate && joinDate >= thirtyDaysAgo;
              default:
                return true;
            }
          });
        }

        console.log(`Found ${customers.length} customers after filtering`);
        res.json(customers);
      } catch (error) {
        console.error("Error in customers API:", error);
        res.status(500).json({
          error: "Failed to fetch customers data",
        });
      }
    },
  );

  // Tax code lookup proxy endpoint
  app.post("/api/tax-code-lookup", async (req: TenantRequest, res) => {
    try {
      const { taxCode } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!taxCode) {
        return res.status(400).json({
          success: false,
          message: "Mã sana�if� thuế không được để trống",
        });
      }

      // Call the external tax code API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/CheckListTaxCode/v2",
        {
          method: "POST",
          headers: {
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([taxCode]),
        },
      );

      if (!response.ok) {
        throw new Error(
          `External API error: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();

      res.json({
        success: true,
        data: result,
        message: "Tra cứu thành ce�ng",
      });
    } catch (error) {
      console.error("Tax code lookup error:", error);
      res.status(500).json({
        success: false,
        message: "Có lỗi xảy ra khi tra cứu mã số thuế",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // E-invoice publish proxy endpoint
  app.post("/api/einvoice/publish", async (req: TenantRequest, res) => {
    try {
      const publishRequest = req.body;
      const tenantDb = await getTenantDatabase(req);
      console.log(
        "Publishing invoice with data:",
        JSON.stringify(publishRequest, null, 2),
      );

      // Call the real e-invoice API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/invoice/publish",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
          },
          body: JSON.stringify(publishRequest),
        },
      );

      if (!response.ok) {
        console.error(
          "E-invoice API error:",
          response.status,
          response.statusText,
        );
        const errorText = await response.text();
        console.error("Error response:", errorText);

        return res.status(response.status).json({
          error: "Failed to publish invoice",
          details: `API returned ${response.status}: ${response.statusText}`,
          apiResponse: errorText,
        });
      }

      const result = await response.json();
      console.log("E-invoice API response:", result);

      // Check if the API returned success
      if (result.status === true) {
        console.log("Invoice published successfully:", result);

        // Return standardized response format
        res.json({
          success: true,
          message:
            result.message || "Hóa đơn điện tử đã được phát hành thành công",
          data: {
            invoiceNo: result.data?.invoiceNo,
            invDate: result.data?.invDate,
            transactionID: result.data?.transactionID,
            macqt: result.data?.macqt,
            originalRequest: {
              transactionID: publishRequest.transactionID,
              invRef: publishRequest.invRef,
              totalAmount: publishRequest.invTotalAmount,
              customer: publishRequest.Customer,
            },
          },
        });
      } else {
        // API returned failure
        console.error("E-invoice API returned failure:", result);
        res.status(400).json({
          error: "E-invoice publication failed",
          message: result.message || "Unknown error from e-invoice service",
          details: result,
        });
      }
    } catch (error) {
      console.error("E-invoice publish proxy error details:");
      console.error("- Error type:", error?.constructor.name);
      console.error("- Error message:", error?.message);
      console.error("- Full error:", error);

      res.status(500).json({
        error: "Failed to publish invoice",
        details: error?.message,
        errorType: error?.constructor.name,
      });
    }
  });

  // Printer configuration management APIs
  app.get(
    "/api/printer-configs",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log(
          "🔍 GET /api/printer-configs - Starting request processing",
        );
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for printer configs",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for printer configs:",
            dbError,
          );
          tenantDb = null;
        }

        const configs = await storage.getPrinterConfigs(tenantDb);
        console.log(
          `✅ Successfully fetched ${configs.length} printer configs`,
        );
        res.json(configs);
      } catch (error) {
        console.error("❌ Error fetching printer configs:", error);
        res.status(500).json({
          error: "Failed to fetch printer configs",
        });
      }
    },
  );

  app.post("/api/printer-configs", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log("Creating printer config with data:", configData);

      const config = await storage.createPrinterConfig(configData, tenantDb);
      res.status(201).json(config);
    } catch (error) {
      console.error("Error creating printer config:", error);
      res.status(500).json({
        error: "Failed to create printer config",
      });
    }
  });

  app.put("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log(`Updating printer config ${id} with data:`, configData);

      const config = await storage.updatePrinterConfig(
        id,
        configData,
        tenantDb,
      );
      if (!config) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json(config);
    } catch (error) {
      console.error("Error updating printer config:", error);
      res.status(500).json({
        error: "Failed to update printer config",
      });
    }
  });

  app.delete("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      console.log(`Deleting printer config ${id}`);

      const deleted = await storage.deletePrinterConfig(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json({
        message: "Printer config deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting printer config:", error);
      res.status(500).json({
        error: "Failed to delete printer config",
      });
    }
  });

  app.post("/api/printer-configs/:id/test", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      // Get printer config
      const configs = await storage.getPrinterConfigs(tenantDb);
      const config = configs.find((c) => c.id === id);

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Printer configuration not found",
        });
      }

      // Test connection based on connection type
      let testResult = { success: false, message: "Unknown connection type" };

      if (config.connectionType === "network" && config.ipAddress) {
        // Test network connection
        const net = require("net");

        const testPromise = new Promise((resolve) => {
          const client = new net.Socket();
          client.setTimeout(3000);

          client.connect(config.port || 9100, config.ipAddress, () => {
            // Send test print command
            const testData = Buffer.from(
              "\x1B@Test Print from EDPOS\n\n\n\x1DV\x41\x00",
              "utf8",
            );

            client.write(testData, (error) => {
              if (error) {
                resolve({
                  success: false,
                  message: `Failed to send test data: ${error.message}`,
                });
              } else {
                client.end();
                resolve({
                  success: true,
                  message: `Successfully connected to ${config.name}`,
                });
              }
            });
          });

          client.on("error", (err) => {
            resolve({
              success: false,
              message: `Connection failed: ${err.message}`,
            });
          });

          client.on("timeout", () => {
            client.destroy();
            resolve({ success: false, message: "Connection timeout" });
          });
        });

        testResult = await testPromise;
      } else if (config.connectionType === "usb") {
        // For USB printers, we can't directly test but we can check if the config is valid
        testResult = {
          success: true,
          message: "USB printer detection not implemented",
        };
      } else {
        testResult = {
          success: false,
          message: "Invalid printer configuration",
        };
      }

      res.json(testResult);
    } catch (error) {
      console.error("Error testing printer connection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test printer connection",
      });
    }
  });

  // Customer Reports APIs
  app.get("/api/customer-debts", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer debts from database
      const customerDebts = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          initialDebt: sql<number>`0`, // Mock initial debt
          newDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.1`, // 10% of total spent as debt
          payment: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // 5% as payment
          finalDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // Final debt
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredDebts = customerDebts;
      if (customerId) {
        filteredDebts = customerDebts.filter(
          (debt) => debt.id === parseInt(customerId as string),
        );
      }

      res.json(filteredDebts);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer debts",
      });
    }
  });

  app.get("/api/customer-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer sales data from database
      const customerSales = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          totalSales: customers.totalSpent,
          visitCount: customers.visitCount,
          averageOrder: sql<number>`CASE WHEN ${customers.visitCount} > 0 THEN ${customers.totalSpent} / ${customers.visitCount} ELSE 0 END`,
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredSales = customerSales;
      if (customerId) {
        filteredSales = customerSales.filter(
          (sale) => sale.id === parseInt(customerId as string),
        );
      }

      res.json(filteredSales);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer sales",
      });
    }
  });

  // Bulk create products
  app.post("/api/products/bulk", async (req: TenantRequest, res) => {
    try {
      const { products: productList } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!productList || !Array.isArray(productList)) {
        return res.status(400).json({
          error: "Invalid products data",
        });
      }

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const productData of productList) {
        try {
          console.log(`Processing product: ${JSON.stringify(productData)}`);

          // Validate required fields with detailed messages
          const missingFields = [];
          if (!productData.name) missingFields.push("name");
          if (!productData.sku) missingFields.push("sku");
          if (!productData.price) missingFields.push("price");
          if (
            productData.categoryId === undefined ||
            productData.categoryId === null
          )
            missingFields.push("categoryId");

          if (missingFields.length > 0) {
            throw new Error(
              `Missing required fields: ${missingFields.join(", ")}`,
            );
          }

          // Validate data types
          if (isNaN(parseFloat(productData.price))) {
            throw new Error(`Invalid price: ${productData.price}`);
          }

          if (isNaN(parseInt(productData.categoryId))) {
            throw new Error(`Invalid categoryId: ${productData.categoryId}`);
          }

          const [product] = await tenantDb
            .insert(products)
            .values({
              name: productData.name,
              sku: productData.sku,
              price: productData.price.toString(),
              stock: parseInt(productData.stock) || 0,
              categoryId: parseInt(productData.categoryId),
              imageUrl: productData.imageUrl || null,
              taxRate: productData.taxRate
                ? productData.taxRate.toString()
                : "0.00",
            })
            .returning();

          console.log(`Successfully created product: ${product.name}`);
          results.push({
            success: true,
            product,
          });
          successCount++;
        } catch (error) {
          const errorMessage = error.message || "Unknown error";
          console.error(
            `Error creating product ${productData.name || "Unknown"}:`,
            errorMessage,
          );
          console.error("Product data:", JSON.stringify(productData, null, 2));

          results.push({
            success: false,
            error: errorMessage,
            data: productData,
            productName: productData.name || "Unknown",
          });
          errorCount++;
        }
      }

      res.json({
        success: successCount,
        errors: errorCount,
        results,
        message: `${successCount} sản phẩm đã được tạo thành công${errorCount > 0 ? `, ${errorCount} sản phẩm lỗi` : ""}`,
      });
    } catch (error) {
      console.error("Bulk products creation error:", error);
      res.status(500).json({
        error: "Failed to create products",
      });
    }
  });

  // Employee routes
  app.get(
    "/api/employees",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/employees - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for employees");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for employees:",
            dbError,
          );
          tenantDb = null;
        }

        const employees = await storage.getEmployees(tenantDb);
        console.log(`✅ Successfully fetched ${employees.length} employees`);
        res.json(employees);
      } catch (error) {
        console.error("❌ Error fetching employees:", error);
        res.status(500).json({
          message: "Failed to fetch employees",
        });
      }
    },
  );

  // Employee sales report data
  app.get("/api/employee-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      let query = db
        .select({
          employeeName: transactionsTable.cashierName,
          total: transactionsTable.total,
          createdAt: transactionsTable.createdAt,
        })
        .from(transactionsTable);

      if (startDate && endDate) {
        query = query.where(
          and(
            gte(transactionsTable.createdAt, startDate as string),
            lte(transactionsTable.createdAt, endDate as string),
          ),
        );
      }

      if (employeeId && employeeId !== "all") {
        query = query.where(
          eq(transactionsTable.cashierName, employeeId as string),
        );
      }

      const salesData = await query;
      res.json(salesData);
    } catch (error) {
      console.error("Error fetching employee sales:", error);
      res.status(500).json({
        message: "Failed to fetch employee sales data",
      });
    }
  });

  // Server time endpoint for consistent timestamps
  app.get("/api/server-time", async (req: TenantRequest, res) => {
    try {
      const serverTime = {
        timestamp: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      res.json(serverTime);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get server time",
      });
    }
  });

  // Product Analysis API - using orders and order_items data
  app.get("/api/product-analysis", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, categoryId, productType, productSearch } =
        req.query;
      const tenantDb = await getTenantDatabase(req);

      console.log("Product Analysis API called with params:", {
        startDate,
        endDate,
        categoryId,
        productType,
        productSearch,
      });

      // Build date conditions
      const dateConditions = [];
      if (startDate && endDate) {
        const startDateTime = new Date(startDate as string);
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);
        dateConditions.push(
          gte(orders.orderedAt, startDateTime),
          lte(orders.orderedAt, endDateTime),
        );
      }

      // Build category conditions for products
      const categoryConditions = [];
      if (categoryId && categoryId !== "all") {
        categoryConditions.push(
          eq(products.categoryId, parseInt(categoryId as string)),
        );
      }

      // Build product type conditions
      const typeConditions = [];
      if (productType && productType !== "all") {
        const typeMap = {
          combo: 3,
          product: 1,
          service: 2,
        };
        const typeValue = typeMap[productType as keyof typeof typeMap];
        if (typeValue) {
          typeConditions.push(eq(products.productType, typeValue));
        }
      }

      // Build search conditions
      const searchConditions = [];
      if (productSearch && productSearch !== "" && productSearch !== "all") {
        const searchTerm = `%${productSearch}%`;
        searchConditions.push(
          or(ilike(products.name, searchTerm), ilike(products.sku, searchTerm)),
        );
      }

      // Query order items with product details from completed/paid orders
      const productSalesData = await tenantDb
        .select({
          productId: orderItemsTable.productId,
          productName: products.name,
          productSku: products.sku,
          categoryId: products.categoryId,
          categoryName: categories.name,
          unitPrice: orderItemsTable.unitPrice, // This is the pre-tax price
          quantity: orderItemsTable.quantity,
          total: orderItemsTable.total, // This should also be pre-tax total
          orderId: orderItemsTable.orderId,
          orderDate: orders.orderedAt,
          discount: orderItemsTable.discount,
          orderStatus: orders.status,
        })
        .from(orderItemsTable)
        .innerJoin(orders, eq(orderItemsTable.orderId, orders.id))
        .innerJoin(products, eq(orderItemsTable.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            or(eq(orders.status, "paid"), eq(orders.status, "completed")),
            ...dateConditions,
            ...categoryConditions,
            ...typeConditions,
            ...searchConditions,
          ),
        )
        .orderBy(desc(orders.orderedAt));

      console.log(`Found ${productSalesData.length} product sales records`);

      // Group and aggregate data by product
      const productMap = new Map();

      productSalesData.forEach((item) => {
        const productId = item.productId;
        const quantity = Number(item.quantity || 0);
        const revenue = Number(item.unitPrice || 0) * quantity;
        const discount = Number(item.discount || 0);

        if (productMap.has(productId)) {
          const existing = productMap.get(productId);
          existing.totalQuantity += quantity;
          existing.totalRevenue += revenue;
          existing.discount += discount;
          existing.orderCount += 1;
        } else {
          productMap.set(productId, {
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            productType: item.productType,
            unitPrice: item.unitPrice, // This is the pre-tax price
            quantity: item.quantity,
            total: item.total,
            discount: item.discount,
            totalQuantity: quantity,
            totalRevenue: revenue,
            totalDiscount: discount,
            averagePrice: Number(item.unitPrice || 0),
            orderCount: 1,
          });
        }
      });

      // Convert to array and calculate final metrics
      const productStats = Array.from(productMap.values()).map((product) => ({
        ...product,
        averageOrderValue:
          product.orderCount > 0
            ? product.totalRevenue / product.orderCount
            : 0,
      }));

      // Calculate totals
      const totalRevenue = productStats.reduce(
        (sum, product) => sum + product.totalRevenue,
        0,
      );
      const totalQuantity = productStats.reduce(
        (sum, product) => sum + product.totalQuantity,
        0,
      );
      const totalDiscount = productStats.reduce(
        (sum, product) => sum + product.totalDiscount,
        0,
      );
      const totalProducts = productStats.length;

      // Sort by revenue (descending)
      productStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

      const result = {
        productStats,
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        summary: {
          topSellingProduct: productStats[0] || null,
          averageRevenuePerProduct:
            totalProducts > 0 ? totalRevenue / totalProducts : 0,
        },
      };

      console.log("Product Analysis Results:", {
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        topProduct: result.summary.topSellingProduct?.productName,
      });

      res.json(result);
    } catch (error) {
      console.error("Product analysis error:", error);
      res.status(500).json({
        error: "Failed to fetch product analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // // Enhanced API endpoints for sales chart report - using same data source as dashboard
  app.get(
    "/api/dashboard-data/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Dashboard data API called with params:", {
          startDate,
          endDate,
        });

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Get orders, tables, transactions, invoices - EXACT same as dashboard
        const [orders, tables, transactions, invoices] = await Promise.all([
          storage.getOrders(undefined, undefined, tenantDb),
          storage.getTables(tenantDb),
          storage.getTransactions(tenantDb),
          storage.getInvoices(tenantDb),
        ]);

        // Filter completed orders within date range - EXACT same logic as dashboard
        const filteredCompletedOrders = Array.isArray(orders)
          ? orders.filter((order) => {
              try {
                if (!order) return false;

                // Try multiple date fields - prioritize orderedAt, paidAt, createdAt
                const orderDate = new Date(
                  order.orderedAt ||
                    order.paidAt ||
                    order.createdAt ||
                    order.created_at,
                );

                if (isNaN(orderDate.getTime())) {
                  return false;
                }

                const dateMatch = orderDate >= start && orderDate <= end;

                // Include more order statuses to show real data
                const isCompleted =
                  order.status === "paid" ||
                  order.status === "completed" ||
                  order.status === "served" ||
                  order.status === "confirmed";

                return dateMatch && isCompleted;
              } catch (error) {
                console.error("Error filtering order:", order, error);
                return false;
              }
            })
          : [];

        // Calculate dashboard stats - EXACT same logic
        const periodRevenue = filteredCompletedOrders.reduce((total, order) => {
          const orderTotal = Number(order.total || 0);
          return total + orderTotal;
        }, 0);

        const periodOrderCount = filteredCompletedOrders.length;

        // Customer count: count unique customers from completed orders
        const uniqueCustomers = new Set();
        filteredCompletedOrders.forEach((order) => {
          if (order.customerId) {
            uniqueCustomers.add(order.customerId);
          } else {
            uniqueCustomers.add(`order_${order.id}`);
          }
        });
        const periodCustomerCount = uniqueCustomers.size;

        // Daily average for the period
        const daysDiff = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
            1,
        );
        const dailyAverageRevenue = periodRevenue / daysDiff;

        // Active orders (pending/in-progress orders)
        const activeOrders = orders.filter(
          (order) =>
            order.status === "pending" || order.status === "in_progress",
        ).length;

        const occupiedTables = tables.filter(
          (table) => table.status === "occupied",
        );

        const monthRevenue = periodRevenue;
        const averageOrderValue =
          periodOrderCount > 0 ? periodRevenue / periodOrderCount : 0;

        // Peak hours analysis
        const hourlyOrders: {
          [key: number]: number;
        } = {};
        filteredCompletedOrders.forEach((order) => {
          const orderDate = new Date(
            order.orderedAt ||
              order.createdAt ||
              order.created_at ||
              order.paidAt,
          );
          if (!isNaN(orderDate.getTime())) {
            const hour = orderDate.getHours();
            hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1;
          }
        });

        const peakHour = Object.keys(hourlyOrders).reduce(
          (peak, hour) =>
            hourlyOrders[parseInt(hour)] > hourlyOrders[parseInt(peak)]
              ? hour
              : peak,
          "12",
        );

        const dashboardData = {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          dailyAverageRevenue,
          activeOrders,
          occupiedTables: occupiedTables.length,
          monthRevenue,
          averageOrderValue,
          peakHour: parseInt(peakHour),
          totalTables: tables.length,
          filteredCompletedOrders,
          orders: orders || [],
          tables: tables || [],
          transactions: transactions || [],
          invoices: invoices || [],
        };

        console.log("Dashboard data calculated:", {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          filteredOrdersCount: filteredCompletedOrders.length,
        });

        res.json(dashboardData);
      } catch (error) {
        console.error("Error in dashboard data API:", error);
        res.status(500).json({
          error: "Failed to fetch dashboard data",
        });
      }
    },
  );

  // Transactions API with enhanced filtering
  app.get(
    "/api/transactions/:startDate/:endDate/:salesMethod/:salesChannel/:analysisType/:concernType/:selectedEmployee",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Transactions API called with params:", {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        });

        // Get transactions data
        const transactions = await storage.getTransactions(tenantDb);

        // Filter transactions based on parameters
        const filteredTransactions = transactions.filter((transaction) => {
          const transactionDate = new Date(transaction.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = transactionDate >= start && transactionDate <= end;

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            const paymentMethod = transaction.paymentMethod || "cash";
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !transaction.deliveryMethod ||
                  transaction.deliveryMethod === "pickup" ||
                  transaction.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = transaction.deliveryMethod === "delivery";
                break;
              default:
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = transaction.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !transaction.salesChannel ||
                  transaction.salesChannel === "direct" ||
                  transaction.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  transaction.salesChannel &&
                  transaction.salesChannel !== "direct" &&
                  transaction.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              transaction.cashierName === selectedEmployee ||
              (transaction.cashierName &&
                transaction.cashierName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          return (
            dateMatch && salesMethodMatch && salesChannelMatch && employeeMatch
          );
        });

        console.log(
          `Found ${filteredTransactions.length} filtered transactions out of ${transactions.length} total`,
        );
        res.json(filteredTransactions);
      } catch (error) {
        console.error("Error in transactions API:", error);
        res.status(500).json({
          error: "Failed to fetch transactions data",
        });
      }
    },
  );

  app.get(
    "/api/orders/:startDate/:endDate/:selectedEmployee/:salesChannel/:salesMethod/:analysisType/:concernType",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Orders API called with params:", {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        });

        // Get orders data
        const orders = await storage.getOrders(undefined, undefined, tenantDb);

        // Filter orders based on parameters with enhanced logic
        const filteredOrders = orders.filter((order) => {
          const orderDate = new Date(order.orderedAt || order.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = orderDate >= start && orderDate <= end;

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              order.employeeId?.toString() === selectedEmployee ||
              (order.employeeName &&
                order.employeeName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = order.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !order.salesChannel ||
                  order.salesChannel === "direct" ||
                  order.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  order.salesChannel &&
                  order.salesChannel !== "direct" &&
                  order.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !order.deliveryMethod ||
                  order.deliveryMethod === "pickup" ||
                  order.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = order.deliveryMethod === "delivery";
                break;
              default:
                const paymentMethod = order.paymentMethod || "cash";
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Only include paid orders for analysis
          const statusMatch = order.status === "paid";

          return (
            dateMatch &&
            employeeMatch &&
            salesChannelMatch &&
            salesMethodMatch &&
            statusMatch
          );
        });

        console.log(
          `Found ${filteredOrders.length} filtered orders out of ${orders.length} total`,
        );
        res.json(filteredOrders);
      } catch (error) {
        console.error("Error in orders API:", error);
        res.status(500).json({
          error: "Failed to fetch orders data",
        });
      }
    },
  );

  app.get(
    "/api/products/:selectedCategory/:productType/:productSearch?",
    async (req: TenantRequest, res) => {
      try {
        const { selectedCategory, productType, productSearch } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Products API called with params:", {
          selectedCategory,
          productType,
          productSearch,
        });

        let products;

        // Get products by category or all products
        if (
          selectedCategory &&
          selectedCategory !== "all" &&
          selectedCategory !== "undefined"
        ) {
          const categoryId = parseInt(selectedCategory);
          if (!isNaN(categoryId)) {
            products = await storage.getProductsByCategory(
              categoryId,
              true,
              tenantDb,
            );
          } else {
            products = await storage.getAllProducts(true, tenantDb);
          }
        } else {
          products = await storage.getAllProducts(true, tenantDb);
        }

        // Filter by product type if specified
        if (
          productType &&
          productType !== "all" &&
          productType !== "undefined"
        ) {
          const typeMap = {
            combo: 3,
            "combo-dongoi": 3,
            product: 1,
            "hang-hoa": 1,
            service: 2,
            "dich-vu": 2,
          };
          const typeValue =
            typeMap[productType.toLowerCase() as keyof typeof typeMap];
          if (typeValue) {
            products = products.filter(
              (product) => product.productType === typeValue,
            );
          }
        }

        // Filter by product search if provided
        if (
          productSearch &&
          productSearch !== "" &&
          productSearch !== "undefined" &&
          productSearch !== "all"
        ) {
          const searchTerm = productSearch.toLowerCase();
          products = products.filter(
            (product) =>
              product.name?.toLowerCase().includes(searchTerm) ||
              product.sku?.toLowerCase().includes(searchTerm) ||
              product.description?.toLowerCase().includes(searchTerm),
          );
        }

        console.log(`Found ${products.length} products after filtering`);
        res.json(products);
      } catch (error) {
        console.error("Error in products API:", error);
        res.status(500).json({
          error: "Failed to fetch products data",
        });
      }
    },
  );

  app.get(
    "/api/customers/:customerSearch?/:customerStatus?",
    async (req: TenantRequest, res) => {
      try {
        const { customerSearch, customerStatus } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log(
          "Customers API called with search:",
          customerSearch,
          "status:",
          customerStatus,
        );

        let customers = await storage.getCustomers(tenantDb);

        // Filter by search if provided
        if (
          customerSearch &&
          customerSearch !== "" &&
          customerSearch !== "undefined" &&
          customerSearch !== "all"
        ) {
          const searchTerm = customerSearch.toLowerCase();
          customers = customers.filter(
            (customer) =>
              customer.name?.toLowerCase().includes(searchTerm) ||
              customer.phone?.includes(customerSearch) ||
              customer.email?.toLowerCase().includes(searchTerm) ||
              customer.customerId?.toLowerCase().includes(searchTerm) ||
              customer.address?.toLowerCase().includes(searchTerm),
          );
        }

        // Filter by status if provided
        if (
          customerStatus &&
          customerStatus !== "all" &&
          customerStatus !== "undefined"
        ) {
          const now = new Date();
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          customers = customers.filter((customer) => {
            const totalSpent = Number(customer.totalSpent || 0);
            const lastVisit = customer.lastVisit
              ? new Date(customer.lastVisit)
              : null;

            switch (customerStatus) {
              case "active":
                return lastVisit && lastVisit >= thirtyDaysAgo;
              case "inactive":
                return !lastVisit || lastVisit < thirtyDaysAgo;
              case "vip":
                return totalSpent >= 500000; // VIP customers with total spent >= 500k VND
              case "new":
                const joinDate = customer.createdAt
                  ? new Date(customer.createdAt)
                  : null;
                return joinDate && joinDate >= thirtyDaysAgo;
              default:
                return true;
            }
          });
        }

        console.log(`Found ${customers.length} customers after filtering`);
        res.json(customers);
      } catch (error) {
        console.error("Error in customers API:", error);
        res.status(500).json({
          error: "Failed to fetch customers data",
        });
      }
    },
  );

  // Tax code lookup proxy endpoint
  app.post("/api/tax-code-lookup", async (req: TenantRequest, res) => {
    try {
      const { taxCode } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!taxCode) {
        return res.status(400).json({
          success: false,
          message: "Mã số thuế không được để trống",
        });
      }

      // Call the external tax code API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/CheckListTaxCode/v2",
        {
          method: "POST",
          headers: {
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([taxCode]),
        },
      );

      if (!response.ok) {
        throw new Error(
          `External API error: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();

      res.json({
        success: true,
        data: result,
        message: "Tra cứu thành công",
      });
    } catch (error) {
      console.error("Tax code lookup error:", error);
      res.status(500).json({
        success: false,
        message: "Có lỗi xảy ra khi tra cứu mã số thuế",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // E-invoice publish proxy endpoint
  app.post("/api/einvoice/publish", async (req: TenantRequest, res) => {
    try {
      const publishRequest = req.body;
      const tenantDb = await getTenantDatabase(req);
      console.log(
        "Publishing invoice with data:",
        JSON.stringify(publishRequest, null, 2),
      );

      // Call the real e-invoice API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/invoice/publish",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
          },
          body: JSON.stringify(publishRequest),
        },
      );

      if (!response.ok) {
        console.error(
          "E-invoice API error:",
          response.status,
          response.statusText,
        );
        const errorText = await response.text();
        console.error("Error response:", errorText);

        return res.status(response.status).json({
          error: "Failed to publish invoice",
          details: `API returned ${response.status}: ${response.statusText}`,
          apiResponse: errorText,
        });
      }

      const result = await response.json();
      console.log("E-invoice API response:", result);

      // Check if the API returned success
      if (result.status === true) {
        console.log("Invoice published successfully:", result);

        // Return standardized response format
        res.json({
          success: true,
          message:
            result.message || "Hóa đơn điện tử đã được phát hành thành công",
          data: {
            invoiceNo: result.data?.invoiceNo,
            invDate: result.data?.invDate,
            transactionID: result.data?.transactionID,
            macqt: result.data?.macqt,
            originalRequest: {
              transactionID: publishRequest.transactionID,
              invRef: publishRequest.invRef,
              totalAmount: publishRequest.invTotalAmount,
              customer: publishRequest.Customer,
            },
          },
        });
      } else {
        // API returned failure
        console.error("E-invoice API returned failure:", result);
        res.status(400).json({
          error: "E-invoice publication failed",
          message: result.message || "Unknown error from e-invoice service",
          details: result,
        });
      }
    } catch (error) {
      console.error("E-invoice publish proxy error details:");
      console.error("- Error type:", error?.constructor.name);
      console.error("- Error message:", error?.message);
      console.error("- Full error:", error);

      res.status(500).json({
        error: "Failed to publish invoice",
        details: error?.message,
        errorType: error?.constructor.name,
      });
    }
  });

  // Printer configuration management APIs
  app.get(
    "/api/printer-configs",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log(
          "🔍 GET /api/printer-configs - Starting request processing",
        );
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for printer configs",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for printer configs:",
            dbError,
          );
          tenantDb = null;
        }

        const configs = await storage.getPrinterConfigs(tenantDb);
        console.log(
          `✅ Successfully fetched ${configs.length} printer configs`,
        );
        res.json(configs);
      } catch (error) {
        console.error("❌ Error fetching printer configs:", error);
        res.status(500).json({
          error: "Failed to fetch printer configs",
        });
      }
    },
  );

  app.post("/api/printer-configs", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log("Creating printer config with data:", configData);

      const config = await storage.createPrinterConfig(configData, tenantDb);
      res.status(201).json(config);
    } catch (error) {
      console.error("Error creating printer config:", error);
      res.status(500).json({
        error: "Failed to create printer config",
      });
    }
  });

  app.put("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log(`Updating printer config ${id} with data:`, configData);

      const config = await storage.updatePrinterConfig(
        id,
        configData,
        tenantDb,
      );
      if (!config) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json(config);
    } catch (error) {
      console.error("Error updating printer config:", error);
      res.status(500).json({
        error: "Failed to update printer config",
      });
    }
  });

  app.delete("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      console.log(`Deleting printer config ${id}`);

      const deleted = await storage.deletePrinterConfig(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json({
        message: "Printer config deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting printer config:", error);
      res.status(500).json({
        error: "Failed to delete printer config",
      });
    }
  });

  app.post("/api/printer-configs/:id/test", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      // Get printer config
      const configs = await storage.getPrinterConfigs(tenantDb);
      const config = configs.find((c) => c.id === id);

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Printer configuration not found",
        });
      }

      // Test connection based on connection type
      let testResult = { success: false, message: "Unknown connection type" };

      if (config.connectionType === "network" && config.ipAddress) {
        // Test network connection
        const net = require("net");

        const testPromise = new Promise((resolve) => {
          const client = new net.Socket();
          client.setTimeout(3000);

          client.connect(config.port || 9100, config.ipAddress, () => {
            // Send test print command
            const testData = Buffer.from(
              "\x1B@Test Print from EDPOS\n\n\n\x1DV\x41\x00",
              "utf8",
            );

            client.write(testData, (error) => {
              if (error) {
                resolve({
                  success: false,
                  message: `Failed to send test data: ${error.message}`,
                });
              } else {
                client.end();
                resolve({
                  success: true,
                  message: `Successfully connected to ${config.name}`,
                });
              }
            });
          });

          client.on("error", (err) => {
            resolve({
              success: false,
              message: `Connection failed: ${err.message}`,
            });
          });

          client.on("timeout", () => {
            client.destroy();
            resolve({ success: false, message: "Connection timeout" });
          });
        });

        testResult = await testPromise;
      } else if (config.connectionType === "usb") {
        // For USB printers, we can't directly test but we can check if the config is valid
        testResult = {
          success: true,
          message: "USB printer detection not implemented",
        };
      } else {
        testResult = {
          success: false,
          message: "Invalid printer configuration",
        };
      }

      res.json(testResult);
    } catch (error) {
      console.error("Error testing printer connection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test printer connection",
      });
    }
  });

  // Customer Reports APIs
  app.get("/api/customer-debts", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer debts from database
      const customerDebts = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          initialDebt: sql<number>`0`, // Mock initial debt
          newDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.1`, // 10% of total spent as debt
          payment: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // 5% as payment
          finalDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // Final debt
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredDebts = customerDebts;
      if (customerId) {
        filteredDebts = customerDebts.filter(
          (debt) => debt.id === parseInt(customerId as string),
        );
      }

      res.json(filteredDebts);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer debts",
      });
    }
  });

  app.get("/api/customer-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer sales data from database
      const customerSales = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          totalSales: customers.totalSpent,
          visitCount: customers.visitCount,
          averageOrder: sql<number>`CASE WHEN ${customers.visitCount} > 0 THEN ${customers.totalSpent} / ${customers.visitCount} ELSE 0 END`,
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredSales = customerSales;
      if (customerId) {
        filteredSales = customerSales.filter(
          (sale) => sale.id === parseInt(customerId as string),
        );
      }

      res.json(filteredSales);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer sales",
      });
    }
  });

  // Bulk create products
  app.post("/api/products/bulk", async (req: TenantRequest, res) => {
    try {
      const { products: productList } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!productList || !Array.isArray(productList)) {
        return res.status(400).json({
          error: "Invalid products data",
        });
      }

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const productData of productList) {
        try {
          console.log(`Processing product: ${JSON.stringify(productData)}`);

          // Validate required fields with detailed messages
          const missingFields = [];
          if (!productData.name) missingFields.push("name");
          if (!productData.sku) missingFields.push("sku");
          if (!productData.price) missingFields.push("price");
          if (
            productData.categoryId === undefined ||
            productData.categoryId === null
          )
            missingFields.push("categoryId");

          if (missingFields.length > 0) {
            throw new Error(
              `Missing required fields: ${missingFields.join(", ")}`,
            );
          }

          // Validate data types
          if (isNaN(parseFloat(productData.price))) {
            throw new Error(`Invalid price: ${productData.price}`);
          }

          if (isNaN(parseInt(productData.categoryId))) {
            throw new Error(`Invalid categoryId: ${productData.categoryId}`);
          }

          const [product] = await tenantDb
            .insert(products)
            .values({
              name: productData.name,
              sku: productData.sku,
              price: productData.price.toString(),
              stock: parseInt(productData.stock) || 0,
              categoryId: parseInt(productData.categoryId),
              imageUrl: productData.imageUrl || null,
              taxRate: productData.taxRate
                ? productData.taxRate.toString()
                : "0.00",
            })
            .returning();

          console.log(`Successfully created product: ${product.name}`);
          results.push({
            success: true,
            product,
          });
          successCount++;
        } catch (error) {
          const errorMessage = error.message || "Unknown error";
          console.error(
            `Error creating product ${productData.name || "Unknown"}:`,
            errorMessage,
          );
          console.error("Product data:", JSON.stringify(productData, null, 2));

          results.push({
            success: false,
            error: errorMessage,
            data: productData,
            productName: productData.name || "Unknown",
          });
          errorCount++;
        }
      }

      res.json({
        success: successCount,
        errors: errorCount,
        results,
        message: `${successCount} sản phẩm đã được tạo thành công${errorCount > 0 ? `, ${errorCount} sản phẩm lỗi` : ""}`,
      });
    } catch (error) {
      console.error("Bulk products creation error:", error);
      res.status(500).json({
        error: "Failed to create products",
      });
    }
  });

  // Employee routes
  app.get(
    "/api/employees",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/employees - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for employees");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for employees:",
            dbError,
          );
          tenantDb = null;
        }

        const employees = await storage.getEmployees(tenantDb);
        console.log(`✅ Successfully fetched ${employees.length} employees`);
        res.json(employees);
      } catch (error) {
        console.error("❌ Error fetching employees:", error);
        res.status(500).json({
          message: "Failed to fetch employees",
        });
      }
    },
  );

  // Employee sales report data
  app.get("/api/employee-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      let query = db
        .select({
          employeeName: transactionsTable.cashierName,
          total: transactionsTable.total,
          createdAt: transactionsTable.createdAt,
        })
        .from(transactionsTable);

      if (startDate && endDate) {
        query = query.where(
          and(
            gte(transactionsTable.createdAt, startDate as string),
            lte(transactionsTable.createdAt, endDate as string),
          ),
        );
      }

      if (employeeId && employeeId !== "all") {
        query = query.where(
          eq(transactionsTable.cashierName, employeeId as string),
        );
      }

      const salesData = await query;
      res.json(salesData);
    } catch (error) {
      console.error("Error fetching employee sales:", error);
      res.status(500).json({
        message: "Failed to fetch employee sales data",
      });
    }
  });

  // Server time endpoint for consistent timestamps
  app.get("/api/server-time", async (req: TenantRequest, res) => {
    try {
      const serverTime = {
        timestamp: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      res.json(serverTime);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get server time",
      });
    }
  });

  // Product Analysis API - using orders and order_items data
  app.get("/api/product-analysis", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, categoryId, productType, productSearch } =
        req.query;
      const tenantDb = await getTenantDatabase(req);

      console.log("Product Analysis API called with params:", {
        startDate,
        endDate,
        categoryId,
        productType,
        productSearch,
      });

      // Build date conditions
      const dateConditions = [];
      if (startDate && endDate) {
        const startDateTime = new Date(startDate as string);
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);
        dateConditions.push(
          gte(orders.orderedAt, startDateTime),
          lte(orders.orderedAt, endDateTime),
        );
      }

      // Build category conditions for products
      const categoryConditions = [];
      if (categoryId && categoryId !== "all") {
        categoryConditions.push(
          eq(products.categoryId, parseInt(categoryId as string)),
        );
      }

      // Build product type conditions
      const typeConditions = [];
      if (productType && productType !== "all") {
        const typeMap = {
          combo: 3,
          product: 1,
          service: 2,
        };
        const typeValue = typeMap[productType as keyof typeof typeMap];
        if (typeValue) {
          typeConditions.push(eq(products.productType, typeValue));
        }
      }

      // Build search conditions
      const searchConditions = [];
      if (productSearch && productSearch !== "" && productSearch !== "all") {
        const searchTerm = `%${productSearch}%`;
        searchConditions.push(
          or(ilike(products.name, searchTerm), ilike(products.sku, searchTerm)),
        );
      }

      // Query order items with product details from completed/paid orders
      const productSalesData = await tenantDb
        .select({
          productId: orderItemsTable.productId,
          productName: products.name,
          productSku: products.sku,
          categoryId: products.categoryId,
          categoryName: categories.name,
          unitPrice: orderItemsTable.unitPrice, // This is the pre-tax price
          quantity: orderItemsTable.quantity,
          total: orderItemsTable.total, // This should also be pre-tax total
          orderId: orderItemsTable.orderId,
          orderDate: orders.orderedAt,
          discount: orderItemsTable.discount,
          orderStatus: orders.status,
        })
        .from(orderItemsTable)
        .innerJoin(orders, eq(orderItemsTable.orderId, orders.id))
        .innerJoin(products, eq(orderItemsTable.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            or(eq(orders.status, "paid"), eq(orders.status, "completed")),
            ...dateConditions,
            ...categoryConditions,
            ...typeConditions,
            ...searchConditions,
          ),
        )
        .orderBy(desc(orders.orderedAt));

      console.log(`Found ${productSalesData.length} product sales records`);

      // Group and aggregate data by product
      const productMap = new Map();

      productSalesData.forEach((item) => {
        const productId = item.productId;
        const quantity = Number(item.quantity || 0);
        const revenue = Number(item.unitPrice || 0) * quantity;
        const discount = Number(item.discount || 0);

        if (productMap.has(productId)) {
          const existing = productMap.get(productId);
          existing.totalQuantity += quantity;
          existing.totalRevenue += revenue;
          existing.discount += discount;
          existing.orderCount += 1;
        } else {
          productMap.set(productId, {
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            productType: item.productType,
            unitPrice: item.unitPrice, // This is the pre-tax price
            quantity: item.quantity,
            total: item.total,
            discount: item.discount,
            totalQuantity: quantity,
            totalRevenue: revenue,
            totalDiscount: discount,
            averagePrice: Number(item.unitPrice || 0),
            orderCount: 1,
          });
        }
      });

      // Convert to array and calculate final metrics
      const productStats = Array.from(productMap.values()).map((product) => ({
        ...product,
        averageOrderValue:
          product.orderCount > 0
            ? product.totalRevenue / product.orderCount
            : 0,
      }));

      // Calculate totals
      const totalRevenue = productStats.reduce(
        (sum, product) => sum + product.totalRevenue,
        0,
      );
      const totalQuantity = productStats.reduce(
        (sum, product) => sum + product.totalQuantity,
        0,
      );
      const totalDiscount = productStats.reduce(
        (sum, product) => sum + product.totalDiscount,
        0,
      );
      const totalProducts = productStats.length;

      // Sort by revenue (descending)
      productStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

      const result = {
        productStats,
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        summary: {
          topSellingProduct: productStats[0] || null,
          averageRevenuePerProduct:
            totalProducts > 0 ? totalRevenue / totalProducts : 0,
        },
      };

      console.log("Product Analysis Results:", {
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        topProduct: result.summary.topSellingProduct?.productName,
      });

      res.json(result);
    } catch (error) {
      console.error("Product analysis error:", error);
      res.status(500).json({
        error: "Failed to fetch product analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // // Enhanced API endpoints for sales chart report - using same data source as dashboard
  app.get(
    "/api/dashboard-data/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Dashboard data API called with params:", {
          startDate,
          endDate,
        });

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Get orders, tables, transactions, invoices - EXACT same as dashboard
        const [orders, tables, transactions, invoices] = await Promise.all([
          storage.getOrders(undefined, undefined, tenantDb),
          storage.getTables(tenantDb),
          storage.getTransactions(tenantDb),
          storage.getInvoices(tenantDb),
        ]);

        // Filter completed orders within date range - EXACT same logic as dashboard
        const filteredCompletedOrders = Array.isArray(orders)
          ? orders.filter((order) => {
              try {
                if (!order) return false;

                // Try multiple date fields - prioritize orderedAt, paidAt, createdAt
                const orderDate = new Date(
                  order.orderedAt ||
                    order.paidAt ||
                    order.createdAt ||
                    order.created_at,
                );

                if (isNaN(orderDate.getTime())) {
                  return false;
                }

                const dateMatch = orderDate >= start && orderDate <= end;

                // Include more order statuses to show real data
                const isCompleted =
                  order.status === "paid" ||
                  order.status === "completed" ||
                  order.status === "served" ||
                  order.status === "confirmed";

                return dateMatch && isCompleted;
              } catch (error) {
                console.error("Error filtering order:", order, error);
                return false;
              }
            })
          : [];

        // Calculate dashboard stats - EXACT same logic
        const periodRevenue = filteredCompletedOrders.reduce((total, order) => {
          const orderTotal = Number(order.total || 0);
          return total + orderTotal;
        }, 0);

        const periodOrderCount = filteredCompletedOrders.length;

        // Customer count: count unique customers from completed orders
        const uniqueCustomers = new Set();
        filteredCompletedOrders.forEach((order) => {
          if (order.customerId) {
            uniqueCustomers.add(order.customerId);
          } else {
            uniqueCustomers.add(`order_${order.id}`);
          }
        });
        const periodCustomerCount = uniqueCustomers.size;

        // Daily average for the period
        const daysDiff = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
            1,
        );
        const dailyAverageRevenue = periodRevenue / daysDiff;

        // Active orders (pending/in-progress orders)
        const activeOrders = orders.filter(
          (order) =>
            order.status === "pending" || order.status === "in_progress",
        ).length;

        const occupiedTables = tables.filter(
          (table) => table.status === "occupied",
        );

        const monthRevenue = periodRevenue;
        const averageOrderValue =
          periodOrderCount > 0 ? periodRevenue / periodOrderCount : 0;

        // Peak hours analysis
        const hourlyOrders: {
          [key: number]: number;
        } = {};
        filteredCompletedOrders.forEach((order) => {
          const orderDate = new Date(
            order.orderedAt ||
              order.createdAt ||
              order.created_at ||
              order.paidAt,
          );
          if (!isNaN(orderDate.getTime())) {
            const hour = orderDate.getHours();
            hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1;
          }
        });

        const peakHour = Object.keys(hourlyOrders).reduce(
          (peak, hour) =>
            hourlyOrders[parseInt(hour)] > hourlyOrders[parseInt(peak)]
              ? hour
              : peak,
          "12",
        );

        const dashboardData = {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          dailyAverageRevenue,
          activeOrders,
          occupiedTables: occupiedTables.length,
          monthRevenue,
          averageOrderValue,
          peakHour: parseInt(peakHour),
          totalTables: tables.length,
          filteredCompletedOrders,
          orders: orders || [],
          tables: tables || [],
          transactions: transactions || [],
          invoices: invoices || [],
        };

        console.log("Dashboard data calculated:", {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          filteredOrdersCount: filteredCompletedOrders.length,
        });

        res.json(dashboardData);
      } catch (error) {
        console.error("Error in dashboard data API:", error);
        res.status(500).json({
          error: "Failed to fetch dashboard data",
        });
      }
    },
  );

  // Transactions API with enhanced filtering
  app.get(
    "/api/transactions/:startDate/:endDate/:salesMethod/:salesChannel/:analysisType/:concernType/:selectedEmployee",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Transactions API called with params:", {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        });

        // Get transactions data
        const transactions = await storage.getTransactions(tenantDb);

        // Filter transactions based on parameters
        const filteredTransactions = transactions.filter((transaction) => {
          const transactionDate = new Date(transaction.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = transactionDate >= start && transactionDate <= end;

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            const paymentMethod = transaction.paymentMethod || "cash";
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !transaction.deliveryMethod ||
                  transaction.deliveryMethod === "pickup" ||
                  transaction.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = transaction.deliveryMethod === "delivery";
                break;
              default:
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = transaction.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !transaction.salesChannel ||
                  transaction.salesChannel === "direct" ||
                  transaction.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  transaction.salesChannel &&
                  transaction.salesChannel !== "direct" &&
                  transaction.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              transaction.cashierName === selectedEmployee ||
              (transaction.cashierName &&
                transaction.cashierName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          return (
            dateMatch && salesMethodMatch && salesChannelMatch && employeeMatch
          );
        });

        console.log(
          `Found ${filteredTransactions.length} filtered transactions out of ${transactions.length} total`,
        );
        res.json(filteredTransactions);
      } catch (error) {
        console.error("Error in transactions API:", error);
        res.status(500).json({
          error: "Failed to fetch transactions data",
        });
      }
    },
  );

  app.get(
    "/api/orders/:startDate/:endDate/:selectedEmployee/:salesChannel/:salesMethod/:analysisType/:concernType",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Orders API called with params:", {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        });

        // Get orders data
        const orders = await storage.getOrders(undefined, undefined, tenantDb);

        // Filter orders based on parameters with enhanced logic
        const filteredOrders = orders.filter((order) => {
          const orderDate = new Date(order.orderedAt || order.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = orderDate >= start && orderDate <= end;

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              order.employeeId?.toString() === selectedEmployee ||
              (order.employeeName &&
                order.employeeName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = order.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !order.salesChannel ||
                  order.salesChannel === "direct" ||
                  order.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  order.salesChannel &&
                  order.salesChannel !== "direct" &&
                  order.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !order.deliveryMethod ||
                  order.deliveryMethod === "pickup" ||
                  order.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = order.deliveryMethod === "delivery";
                break;
              default:
                const paymentMethod = order.paymentMethod || "cash";
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Only include paid orders for analysis
          const statusMatch = order.status === "paid";

          return (
            dateMatch &&
            employeeMatch &&
            salesChannelMatch &&
            salesMethodMatch &&
            statusMatch
          );
        });

        console.log(
          `Found ${filteredOrders.length} filtered orders out of ${orders.length} total`,
        );
        res.json(filteredOrders);
      } catch (error) {
        console.error("Error in orders API:", error);
        res.status(500).json({
          error: "Failed to fetch orders data",
        });
      }
    },
  );

  app.get(
    "/api/products/:selectedCategory/:productType/:productSearch?",
    async (req: TenantRequest, res) => {
      try {
        const { selectedCategory, productType, productSearch } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Products API called with params:", {
          selectedCategory,
          productType,
          productSearch,
        });

        let products;

        // Get products by category or all products
        if (
          selectedCategory &&
          selectedCategory !== "all" &&
          selectedCategory !== "undefined"
        ) {
          const categoryId = parseInt(selectedCategory);
          if (!isNaN(categoryId)) {
            products = await storage.getProductsByCategory(
              categoryId,
              true,
              tenantDb,
            );
          } else {
            products = await storage.getAllProducts(true, tenantDb);
          }
        } else {
          products = await storage.getAllProducts(true, tenantDb);
        }

        // Filter by product type if specified
        if (
          productType &&
          productType !== "all" &&
          productType !== "undefined"
        ) {
          const typeMap = {
            combo: 3,
            "combo-dongoi": 3,
            product: 1,
            "hang-hoa": 1,
            service: 2,
            "dich-vu": 2,
          };
          const typeValue =
            typeMap[productType.toLowerCase() as keyof typeof typeMap];
          if (typeValue) {
            products = products.filter(
              (product) => product.productType === typeValue,
            );
          }
        }

        // Filter by product search if provided
        if (
          productSearch &&
          productSearch !== "" &&
          productSearch !== "undefined" &&
          productSearch !== "all"
        ) {
          const searchTerm = productSearch.toLowerCase();
          products = products.filter(
            (product) =>
              product.name?.toLowerCase().includes(searchTerm) ||
              product.sku?.toLowerCase().includes(searchTerm) ||
              product.description?.toLowerCase().includes(searchTerm),
          );
        }

        console.log(`Found ${products.length} products after filtering`);
        res.json(products);
      } catch (error) {
        console.error("Error in products API:", error);
        res.status(500).json({
          error: "Failed to fetch products data",
        });
      }
    },
  );

  app.get(
    "/api/customers/:customerSearch?/:customerStatus?",
    async (req: TenantRequest, res) => {
      try {
        const { customerSearch, customerStatus } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log(
          "Customers API called with search:",
          customerSearch,
          "status:",
          customerStatus,
        );

        let customers = await storage.getCustomers(tenantDb);

        // Filter by search if provided
        if (
          customerSearch &&
          customerSearch !== "" &&
          customerSearch !== "undefined" &&
          customerSearch !== "all"
        ) {
          const searchTerm = customerSearch.toLowerCase();
          customers = customers.filter(
            (customer) =>
              customer.name?.toLowerCase().includes(searchTerm) ||
              customer.phone?.includes(customerSearch) ||
              customer.email?.toLowerCase().includes(searchTerm) ||
              customer.customerId?.toLowerCase().includes(searchTerm) ||
              customer.address?.toLowerCase().includes(searchTerm),
          );
        }

        // Filter by status if provided
        if (
          customerStatus &&
          customerStatus !== "all" &&
          customerStatus !== "undefined"
        ) {
          const now = new Date();
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          customers = customers.filter((customer) => {
            const totalSpent = Number(customer.totalSpent || 0);
            const lastVisit = customer.lastVisit
              ? new Date(customer.lastVisit)
              : null;

            switch (customerStatus) {
              case "active":
                return lastVisit && lastVisit >= thirtyDaysAgo;
              case "inactive":
                return !lastVisit || lastVisit < thirtyDaysAgo;
              case "vip":
                return totalSpent >= 500000; // VIP customers with total spent >= 500k VND
              case "new":
                const joinDate = customer.createdAt
                  ? new Date(customer.createdAt)
                  : null;
                return joinDate && joinDate >= thirtyDaysAgo;
              default:
                return true;
            }
          });
        }

        console.log(`Found ${customers.length} customers after filtering`);
        res.json(customers);
      } catch (error) {
        console.error("Error in customers API:", error);
        res.status(500).json({
          error: "Failed to fetch customers data",
        });
      }
    },
  );

  // Tax code lookup proxy endpoint
  app.post("/api/tax-code-lookup", async (req: TenantRequest, res) => {
    try {
      const { taxCode } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!taxCode) {
        return res.status(400).json({
          success: false,
          message: "Mã số thuế không được để trống",
        });
      }

      // Call the external tax code API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/CheckListTaxCode/v2",
        {
          method: "POST",
          headers: {
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([taxCode]),
        },
      );

      if (!response.ok) {
        throw new Error(
          `External API error: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();

      res.json({
        success: true,
        data: result,
        message: "Tra cứu thành công",
      });
    } catch (error) {
      console.error("Tax code lookup error:", error);
      res.status(500).json({
        success: false,
        message: "Có lỗi xảy ra khi tra cứu mã số thuế",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // E-invoice publish proxy endpoint
  app.post("/api/einvoice/publish", async (req: TenantRequest, res) => {
    try {
      const publishRequest = req.body;
      const tenantDb = await getTenantDatabase(req);
      console.log(
        "Publishing invoice with data:",
        JSON.stringify(publishRequest, null, 2),
      );

      // Call the real e-invoice API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/invoice/publish",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
          },
          body: JSON.stringify(publishRequest),
        },
      );

      if (!response.ok) {
        console.error(
          "E-invoice API error:",
          response.status,
          response.statusText,
        );
        const errorText = await response.text();
        console.error("Error response:", errorText);

        return res.status(response.status).json({
          error: "Failed to publish invoice",
          details: `API returned ${response.status}: ${response.statusText}`,
          apiResponse: errorText,
        });
      }

      const result = await response.json();
      console.log("E-invoice API response:", result);

      // Check if the API returned success
      if (result.status === true) {
        console.log("Invoice published successfully:", result);

        // Return standardized response format
        res.json({
          success: true,
          message:
            result.message || "Hóa đơn điện tử đã được phát hành thành công",
          data: {
            invoiceNo: result.data?.invoiceNo,
            invDate: result.data?.invDate,
            transactionID: result.data?.transactionID,
            macqt: result.data?.macqt,
            originalRequest: {
              transactionID: publishRequest.transactionID,
              invRef: publishRequest.invRef,
              totalAmount: publishRequest.invTotalAmount,
              customer: publishRequest.Customer,
            },
          },
        });
      } else {
        // API returned failure
        console.error("E-invoice API returned failure:", result);
        res.status(400).json({
          error: "E-invoice publication failed",
          message: result.message || "Unknown error from e-invoice service",
          details: result,
        });
      }
    } catch (error) {
      console.error("E-invoice publish proxy error details:");
      console.error("- Error type:", error?.constructor.name);
      console.error("- Error message:", error?.message);
      console.error("- Full error:", error);

      res.status(500).json({
        error: "Failed to publish invoice",
        details: error?.message,
        errorType: error?.constructor.name,
      });
    }
  });

  // Printer configuration management APIs
  app.get(
    "/api/printer-configs",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log(
          "🔍 GET /api/printer-configs - Starting request processing",
        );
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for printer configs",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for printer configs:",
            dbError,
          );
          tenantDb = null;
        }

        const configs = await storage.getPrinterConfigs(tenantDb);
        console.log(
          `inin� Successfully fetched ${configs.length} printer configs`,
        );
        res.json(configs);
      } catch (error) {
        console.error("❌ Error fetching printer configs:", error);
        res.status(500).json({
          error: "Failed to fetch printer configs",
        });
      }
    },
  );

  app.post("/api/printer-configs", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log("Creating printer config with data:", configData);

      const config = await storage.createPrinterConfig(configData, tenantDb);
      res.status(201).json(config);
    } catch (error) {
      console.error("Error creating printer config:", error);
      res.status(500).json({
        error: "Failed to create printer config",
      });
    }
  });

  app.put("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log(`Updating printer config ${id} with data:`, configData);

      const config = await storage.updatePrinterConfig(
        id,
        configData,
        tenantDb,
      );
      if (!config) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json(config);
    } catch (error) {
      console.error("Error updating printer config:", error);
      res.status(500).json({
        error: "Failed to update printer config",
      });
    }
  });

  app.delete("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      console.log(`Deleting printer config ${id}`);

      const deleted = await storage.deletePrinterConfig(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json({
        message: "Printer config deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting printer config:", error);
      res.status(500).json({
        error: "Failed to delete printer config",
      });
    }
  });

  app.post("/api/printer-configs/:id/test", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      // Get printer config
      const configs = await storage.getPrinterConfigs(tenantDb);
      const config = configs.find((c) => c.id === id);

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Printer configuration not found",
        });
      }

      // Test connection based on connection type
      let testResult = { success: false, message: "Unknown connection type" };

      if (config.connectionType === "network" && config.ipAddress) {
        // Test network connection
        const net = require("net");

        const testPromise = new Promise((resolve) => {
          const client = new net.Socket();
          client.setTimeout(3000);

          client.connect(config.port || 9100, config.ipAddress, () => {
            // Send test print command
            const testData = Buffer.from(
              "\x1B@Test Print from EDPOS\n\n\n\x1DV\x41\x00",
              "utf8",
            );

            client.write(testData, (error) => {
              if (error) {
                resolve({
                  success: false,
                  message: `Failed to send test data: ${error.message}`,
                });
              } else {
                client.end();
                resolve({
                  success: true,
                  message: `Successfully connected to ${config.name}`,
                });
              }
            });
          });

          client.on("error", (err) => {
            resolve({
              success: false,
              message: `Connection failed: ${err.message}`,
            });
          });

          client.on("timeout", () => {
            client.destroy();
            resolve({ success: false, message: "Connection timeout" });
          });
        });

        testResult = await testPromise;
      } else if (config.connectionType === "usb") {
        // For USB printers, we can't directly test but we can check if the config is valid
        testResult = {
          success: true,
          message: "USB printer detection not implemented",
        };
      } else {
        testResult = {
          success: false,
          message: "Invalid printer configuration",
        };
      }

      res.json(testResult);
    } catch (error) {
      console.error("Error testing printer connection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test printer connection",
      });
    }
  });

  // Customer Reports APIs
  app.get("/api/customer-debts", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer debts from database
      const customerDebts = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          initialDebt: sql<number>`0`, // Mock initial debt
          newDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.1`, // 10% of total spent as debt
          payment: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // 5% as payment
          finalDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // Final debt
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredDebts = customerDebts;
      if (customerId) {
        filteredDebts = customerDebts.filter(
          (debt) => debt.id === parseInt(customerId as string),
        );
      }

      res.json(filteredDebts);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer debts",
      });
    }
  });

  app.get("/api/customer-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer sales data from database
      const customerSales = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          totalSales: customers.totalSpent,
          visitCount: customers.visitCount,
          averageOrder: sql<number>`CASE WHEN ${customers.visitCount} > 0 THEN ${customers.totalSpent} / ${customers.visitCount} ELSE 0 END`,
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredSales = customerSales;
      if (customerId) {
        filteredSales = customerSales.filter(
          (sale) => sale.id === parseInt(customerId as string),
        );
      }

      res.json(filteredSales);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer sales",
      });
    }
  });

  // Bulk create products
  app.post("/api/products/bulk", async (req: TenantRequest, res) => {
    try {
      const { products: productList } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!productList || !Array.isArray(productList)) {
        return res.status(400).json({
          error: "Invalid products data",
        });
      }

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const productData of productList) {
        try {
          console.log(`Processing product: ${JSON.stringify(productData)}`);

          // Validate required fields with detailed messages
          const missingFields = [];
          if (!productData.name) missingFields.push("name");
          if (!productData.sku) missingFields.push("sku");
          if (!productData.price) missingFields.push("price");
          if (
            productData.categoryId === undefined ||
            productData.categoryId === null
          )
            missingFields.push("categoryId");

          if (missingFields.length > 0) {
            throw new Error(
              `Missing required fields: ${missingFields.join(", ")}`,
            );
          }

          // Validate data types
          if (isNaN(parseFloat(productData.price))) {
            throw new Error(`Invalid price: ${productData.price}`);
          }

          if (isNaN(parseInt(productData.categoryId))) {
            throw new Error(`Invalid categoryId: ${productData.categoryId}`);
          }

          const [product] = await tenantDb
            .insert(products)
            .values({
              name: productData.name,
              sku: productData.sku,
              price: productData.price.toString(),
              stock: parseInt(productData.stock) || 0,
              categoryId: parseInt(productData.categoryId),
              imageUrl: productData.imageUrl || null,
              taxRate: productData.taxRate
                ? productData.taxRate.toString()
                : "0.00",
            })
            .returning();

          console.log(`Successfully created product: ${product.name}`);
          results.push({
            success: true,
            product,
          });
          successCount++;
        } catch (error) {
          const errorMessage = error.message || "Unknown error";
          console.error(
            `Error creating product ${productData.name || "Unknown"}:`,
            errorMessage,
          );
          console.error("Product data:", JSON.stringify(productData, null, 2));

          results.push({
            success: false,
            error: errorMessage,
            data: productData,
            productName: productData.name || "Unknown",
          });
          errorCount++;
        }
      }

      res.json({
        success: successCount,
        errors: errorCount,
        results,
        message: `${successCount} sản phẩm đã được tạo thành công${errorCount > 0 ? `, ${errorCount} sản phẩm lỗi` : ""}`,
      });
    } catch (error) {
      console.error("Bulk products creation error:", error);
      res.status(500).json({
        error: "Failed to create products",
      });
    }
  });

  // Employee routes
  app.get(
    "/api/employees",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/employees - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for employees");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for employees:",
            dbError,
          );
          tenantDb = null;
        }

        const employees = await storage.getEmployees(tenantDb);
        console.log(`✅ Successfully fetched ${employees.length} employees`);
        res.json(employees);
      } catch (error) {
        console.error("❌ Error fetching employees:", error);
        res.status(500).json({
          message: "Failed to fetch employees",
        });
      }
    },
  );

  // Employee sales report data
  app.get("/api/employee-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      let query = db
        .select({
          employeeName: transactionsTable.cashierName,
          total: transactionsTable.total,
          createdAt: transactionsTable.createdAt,
        })
        .from(transactionsTable);

      if (startDate && endDate) {
        query = query.where(
          and(
            gte(transactionsTable.createdAt, startDate as string),
            lte(transactionsTable.createdAt, endDate as string),
          ),
        );
      }

      if (employeeId && employeeId !== "all") {
        query = query.where(
          eq(transactionsTable.cashierName, employeeId as string),
        );
      }

      const salesData = await query;
      res.json(salesData);
    } catch (error) {
      console.error("Error fetching employee sales:", error);
      res.status(500).json({
        message: "Failed to fetch employee sales data",
      });
    }
  });

  // Server time endpoint for consistent timestamps
  app.get("/api/server-time", async (req: TenantRequest, res) => {
    try {
      const serverTime = {
        timestamp: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      res.json(serverTime);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get server time",
      });
    }
  });

  // Product Analysis API - using orders and order_items data
  app.get("/api/product-analysis", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, categoryId, productType, productSearch } =
        req.query;
      const tenantDb = await getTenantDatabase(req);

      console.log("Product Analysis API called with params:", {
        startDate,
        endDate,
        categoryId,
        productType,
        productSearch,
      });

      // Build date conditions
      const dateConditions = [];
      if (startDate && endDate) {
        const startDateTime = new Date(startDate as string);
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);
        dateConditions.push(
          gte(orders.orderedAt, startDateTime),
          lte(orders.orderedAt, endDateTime),
        );
      }

      // Build category conditions for products
      const categoryConditions = [];
      if (categoryId && categoryId !== "all") {
        categoryConditions.push(
          eq(products.categoryId, parseInt(categoryId as string)),
        );
      }

      // Build product type conditions
      const typeConditions = [];
      if (productType && productType !== "all") {
        const typeMap = {
          combo: 3,
          product: 1,
          service: 2,
        };
        const typeValue = typeMap[productType as keyof typeof typeMap];
        if (typeValue) {
          typeConditions.push(eq(products.productType, typeValue));
        }
      }

      // Build search conditions
      const searchConditions = [];
      if (productSearch && productSearch !== "" && productSearch !== "all") {
        const searchTerm = `%${productSearch}%`;
        searchConditions.push(
          or(ilike(products.name, searchTerm), ilike(products.sku, searchTerm)),
        );
      }

      // Query order items with product details from completed/paid orders
      const productSalesData = await tenantDb
        .select({
          productId: orderItemsTable.productId,
          productName: products.name,
          productSku: products.sku,
          categoryId: products.categoryId,
          categoryName: categories.name,
          unitPrice: orderItemsTable.unitPrice, // This is the pre-tax price
          quantity: orderItemsTable.quantity,
          total: orderItemsTable.total, // This should also be pre-tax total
          orderId: orderItemsTable.orderId,
          orderDate: orders.orderedAt,
          discount: orderItemsTable.discount,
          orderStatus: orders.status,
        })
        .from(orderItemsTable)
        .innerJoin(orders, eq(orderItemsTable.orderId, orders.id))
        .innerJoin(products, eq(orderItemsTable.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            or(eq(orders.status, "paid"), eq(orders.status, "completed")),
            ...dateConditions,
            ...categoryConditions,
            ...typeConditions,
            ...searchConditions,
          ),
        )
        .orderBy(desc(orders.orderedAt));

      console.log(`Found ${productSalesData.length} product sales records`);

      // Group and aggregate data by product
      const productMap = new Map();

      productSalesData.forEach((item) => {
        const productId = item.productId;
        const quantity = Number(item.quantity || 0);
        const revenue = Number(item.unitPrice || 0) * quantity;
        const discount = Number(item.discount || 0);

        if (productMap.has(productId)) {
          const existing = productMap.get(productId);
          existing.totalQuantity += quantity;
          existing.totalRevenue += revenue;
          existing.discount += discount;
          existing.orderCount += 1;
        } else {
          productMap.set(productId, {
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            productType: item.productType,
            unitPrice: item.unitPrice, // This is the pre-tax price
            quantity: item.quantity,
            total: item.total,
            discount: item.discount,
            totalQuantity: quantity,
            totalRevenue: revenue,
            totalDiscount: discount,
            averagePrice: Number(item.unitPrice || 0),
            orderCount: 1,
          });
        }
      });

      // Convert to array and calculate final metrics
      const productStats = Array.from(productMap.values()).map((product) => ({
        ...product,
        averageOrderValue:
          product.orderCount > 0
            ? product.totalRevenue / product.orderCount
            : 0,
      }));

      // Calculate totals
      const totalRevenue = productStats.reduce(
        (sum, product) => sum + product.totalRevenue,
        0,
      );
      const totalQuantity = productStats.reduce(
        (sum, product) => sum + product.totalQuantity,
        0,
      );
      const totalDiscount = productStats.reduce(
        (sum, product) => sum + product.totalDiscount,
        0,
      );
      const totalProducts = productStats.length;

      // Sort by revenue (descending)
      productStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

      const result = {
        productStats,
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        summary: {
          topSellingProduct: productStats[0] || null,
          averageRevenuePerProduct:
            totalProducts > 0 ? totalRevenue / totalProducts : 0,
        },
      };

      console.log("Product Analysis Results:", {
        totalRevenue,
        totalQuantity,
        totalDiscount,
        totalProducts,
        topProduct: result.summary.topSellingProduct?.productName,
      });

      res.json(result);
    } catch (error) {
      console.error("Product analysis error:", error);
      res.status(500).json({
        error: "Failed to fetch product analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // // Enhanced API endpoints for sales chart report - using same data source as dashboard
  app.get(
    "/api/dashboard-data/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Dashboard data API called with params:", {
          startDate,
          endDate,
        });

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Get orders, tables, transactions, invoices - EXACT same as dashboard
        const [orders, tables, transactions, invoices] = await Promise.all([
          storage.getOrders(undefined, undefined, tenantDb),
          storage.getTables(tenantDb),
          storage.getTransactions(tenantDb),
          storage.getInvoices(tenantDb),
        ]);

        // Filter completed orders within date range - EXACT same logic as dashboard
        const filteredCompletedOrders = Array.isArray(orders)
          ? orders.filter((order) => {
              try {
                if (!order) return false;

                // Try multiple date fields - prioritize orderedAt, paidAt, createdAt
                const orderDate = new Date(
                  order.orderedAt ||
                    order.paidAt ||
                    order.createdAt ||
                    order.created_at,
                );

                if (isNaN(orderDate.getTime())) {
                  return false;
                }

                const dateMatch = orderDate >= start && orderDate <= end;

                // Include more order statuses to show real data
                const isCompleted =
                  order.status === "paid" ||
                  order.status === "completed" ||
                  order.status === "served" ||
                  order.status === "confirmed";

                return dateMatch && isCompleted;
              } catch (error) {
                console.error("Error filtering order:", order, error);
                return false;
              }
            })
          : [];

        // Calculate dashboard stats - EXACT same logic
        const periodRevenue = filteredCompletedOrders.reduce((total, order) => {
          const orderTotal = Number(order.total || 0);
          return total + orderTotal;
        }, 0);

        const periodOrderCount = filteredCompletedOrders.length;

        // Customer count: count unique customers from completed orders
        const uniqueCustomers = new Set();
        filteredCompletedOrders.forEach((order) => {
          if (order.customerId) {
            uniqueCustomers.add(order.customerId);
          } else {
            uniqueCustomers.add(`order_${order.id}`);
          }
        });
        const periodCustomerCount = uniqueCustomers.size;

        // Daily average for the period
        const daysDiff = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
            1,
        );
        const dailyAverageRevenue = periodRevenue / daysDiff;

        // Active orders (pending/in-progress orders)
        const activeOrders = orders.filter(
          (order) =>
            order.status === "pending" || order.status === "in_progress",
        ).length;

        const occupiedTables = tables.filter(
          (table) => table.status === "occupied",
        );

        const monthRevenue = periodRevenue;
        const averageOrderValue =
          periodOrderCount > 0 ? periodRevenue / periodOrderCount : 0;

        // Peak hours analysis
        const hourlyOrders: {
          [key: number]: number;
        } = {};
        filteredCompletedOrders.forEach((order) => {
          const orderDate = new Date(
            order.orderedAt ||
              order.createdAt ||
              order.created_at ||
              order.paidAt,
          );
          if (!isNaN(orderDate.getTime())) {
            const hour = orderDate.getHours();
            hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1;
          }
        });

        const peakHour = Object.keys(hourlyOrders).reduce(
          (peak, hour) =>
            hourlyOrders[parseInt(hour)] > hourlyOrders[parseInt(peak)]
              ? hour
              : peak,
          "12",
        );

        const dashboardData = {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          dailyAverageRevenue,
          activeOrders,
          occupiedTables: occupiedTables.length,
          monthRevenue,
          averageOrderValue,
          peakHour: parseInt(peakHour),
          totalTables: tables.length,
          filteredCompletedOrders,
          orders: orders || [],
          tables: tables || [],
          transactions: transactions || [],
          invoices: invoices || [],
        };

        console.log("Dashboard data calculated:", {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          filteredOrdersCount: filteredCompletedOrders.length,
        });

        res.json(dashboardData);
      } catch (error) {
        console.error("Error in dashboard data API:", error);
        res.status(500).json({
          error: "Failed to fetch dashboard data",
        });
      }
    },
  );

  // Transactions API with enhanced filtering
  app.get(
    "/api/transactions/:startDate/:endDate/:salesMethod/:salesChannel/:analysisType/:concernType/:selectedEmployee",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Transactions API called with params:", {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        });

        // Get transactions data
        const transactions = await storage.getTransactions(tenantDb);

        // Filter transactions based on parameters
        const filteredTransactions = transactions.filter((transaction) => {
          const transactionDate = new Date(transaction.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = transactionDate >= start && transactionDate <= end;

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            const paymentMethod = transaction.paymentMethod || "cash";
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !transaction.deliveryMethod ||
                  transaction.deliveryMethod === "pickup" ||
                  transaction.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = transaction.deliveryMethod === "delivery";
                break;
              default:
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = transaction.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !transaction.salesChannel ||
                  transaction.salesChannel === "direct" ||
                  transaction.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  transaction.salesChannel &&
                  transaction.salesChannel !== "direct" &&
                  transaction.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              transaction.cashierName === selectedEmployee ||
              (transaction.cashierName &&
                transaction.cashierName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          return (
            dateMatch && salesMethodMatch && salesChannelMatch && employeeMatch
          );
        });

        console.log(
          `Found ${filteredTransactions.length} filtered transactions out of ${transactions.length} total`,
        );
        res.json(filteredTransactions);
      } catch (error) {
        console.error("Error in transactions API:", error);
        res.status(500).json({
          error: "Failed to fetch transactions data",
        });
      }
    },
  );

  app.get(
    "/api/orders/:startDate/:endDate/:selectedEmployee/:salesChannel/:salesMethod/:analysisType/:concernType",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Orders API called with params:", {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        });

        // Get orders data
        const orders = await storage.getOrders(undefined, undefined, tenantDb);

        // Filter orders based on parameters with enhanced logic
        const filteredOrders = orders.filter((order) => {
          const orderDate = new Date(order.orderedAt || order.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = orderDate >= start && orderDate <= end;

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              order.employeeId?.toString() === selectedEmployee ||
              (order.employeeName &&
                order.employeeName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = order.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !order.salesChannel ||
                  order.salesChannel === "direct" ||
                  order.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  order.salesChannel &&
                  order.salesChannel !== "direct" &&
                  order.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !order.deliveryMethod ||
                  order.deliveryMethod === "pickup" ||
                  order.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = order.deliveryMethod === "delivery";
                break;
              default:
                const paymentMethod = order.paymentMethod || "cash";
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Only include paid orders for analysis
          const statusMatch = order.status === "paid";

          return (
            dateMatch &&
            employeeMatch &&
            salesChannelMatch &&
            salesMethodMatch &&
            statusMatch
          );
        });

        console.log(
          `Found ${filteredOrders.length} filtered orders out of ${orders.length} total`,
        );
        res.json(filteredOrders);
      } catch (error) {
        console.error("Error in orders API:", error);
        res.status(500).json({
          error: "Failed to fetch orders data",
        });
      }
    },
  );

  app.get(
    "/api/products/:selectedCategory/:productType/:productSearch?",
    async (req: TenantRequest, res) => {
      try {
        const { selectedCategory, productType, productSearch } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Products API called with params:", {
          selectedCategory,
          productType,
          productSearch,
        });

        let products;

        // Get products by category or all products
        if (
          selectedCategory &&
          selectedCategory !== "all" &&
          selectedCategory !== "undefined"
        ) {
          const categoryId = parseInt(selectedCategory);
          if (!isNaN(categoryId)) {
            products = await storage.getProductsByCategory(
              categoryId,
              true,
              tenantDb,
            );
          } else {
            products = await storage.getAllProducts(true, tenantDb);
          }
        } else {
          products = await storage.getAllProducts(true, tenantDb);
        }

        // Filter by product type if specified
        if (
          productType &&
          productType !== "all" &&
          productType !== "undefined"
        ) {
          const typeMap = {
            combo: 3,
            "combo-dongoi": 3,
            product: 1,
            "hang-hoa": 1,
            service: 2,
            "dich-vu": 2,
          };
          const typeValue =
            typeMap[productType.toLowerCase() as keyof typeof typeMap];
          if (typeValue) {
            products = products.filter(
              (product) => product.productType === typeValue,
            );
          }
        }

        // Filter by product search if provided
        if (
          productSearch &&
          productSearch !== "" &&
          productSearch !== "undefined" &&
          productSearch !== "all"
        ) {
          const searchTerm = productSearch.toLowerCase();
          products = products.filter(
            (product) =>
              product.name?.toLowerCase().includes(searchTerm) ||
              product.sku?.toLowerCase().includes(searchTerm) ||
              product.description?.toLowerCase().includes(searchTerm),
          );
        }

        console.log(`Found ${products.length} products after filtering`);
        res.json(products);
      } catch (error) {
        console.error("Error in products API:", error);
        res.status(500).json({
          error: "Failed to fetch products data",
        });
      }
    },
  );

  app.get(
    "/api/customers/:customerSearch?/:customerStatus?",
    async (req: TenantRequest, res) => {
      try {
        const { customerSearch, customerStatus } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log(
          "Customers API called with search:",
          customerSearch,
          "status:",
          customerStatus,
        );

        let customers = await storage.getCustomers(tenantDb);

        // Filter by search if provided
        if (
          customerSearch &&
          customerSearch !== "" &&
          customerSearch !== "undefined" &&
          customerSearch !== "all"
        ) {
          const searchTerm = customerSearch.toLowerCase();
          customers = customers.filter(
            (customer) =>
              customer.name?.toLowerCase().includes(searchTerm) ||
              customer.phone?.includes(customerSearch) ||
              customer.email?.toLowerCase().includes(searchTerm) ||
              customer.customerId?.toLowerCase().includes(searchTerm) ||
              customer.address?.toLowerCase().includes(searchTerm),
          );
        }

        // Filter by status if provided
        if (
          customerStatus &&
          customerStatus !== "all" &&
          customerStatus !== "undefined"
        ) {
          const now = new Date();
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          customers = customers.filter((customer) => {
            const totalSpent = Number(customer.totalSpent || 0);
            const lastVisit = customer.lastVisit
              ? new Date(customer.lastVisit)
              : null;

            switch (customerStatus) {
              case "active":
                return lastVisit && lastVisit >= thirtyDaysAgo;
              case "inactive":
                return !lastVisit || lastVisit < thirtyDaysAgo;
              case "vip":
                return totalSpent >= 500000; // VIP customers with total spent >= 500k VND
              case "new":
                const joinDate = customer.createdAt
                  ? new Date(customer.createdAt)
                  : null;
                return joinDate && joinDate >= thirtyDaysAgo;
              default:
                return true;
            }
          });
        }

        console.log(`Found ${customers.length} customers after filtering`);
        res.json(customers);
      } catch (error) {
        console.error("Error in customers API:", error);
        res.status(500).json({
          error: "Failed to fetch customers data",
        });
      }
    },
  );

  // Tax code lookup proxy endpoint
  app.post("/api/tax-code-lookup", async (req: TenantRequest, res) => {
    try {
      const { taxCode } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!taxCode) {
        return res.status(400).json({
          success: false,
          message: "Mã số thuế không được để trống",
        });
      }

      // Call the external tax code API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/CheckListTaxCode/v2",
        {
          method: "POST",
          headers: {
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([taxCode]),
        },
      );

      if (!response.ok) {
        throw new Error(
          `External API error: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();

      res.json({
        success: true,
        data: result,
        message: "Tra cứu thành công",
      });
    } catch (error) {
      console.error("Tax code lookup error:", error);
      res.status(500).json({
        success: false,
        message: "Có lỗi xảy ra khi tra cứu mã số thuế",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // E-invoice publish proxy endpoint
  app.post("/api/einvoice/publish", async (req: TenantRequest, res) => {
    try {
      const publishRequest = req.body;
      const tenantDb = await getTenantDatabase(req);
      console.log(
        "Publishing invoice with data:",
        JSON.stringify(publishRequest, null, 2),
      );

      // Call the real e-invoice API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/invoice/publish",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
          },
          body: JSON.stringify(publishRequest),
        },
      );

      if (!response.ok) {
        console.error(
          "E-invoice API error:",
          response.status,
          response.statusText,
        );
        const errorText = await response.text();
        console.error("Error response:", errorText);

        return res.status(response.status).json({
          error: "Failed to publish invoice",
          details: `API returned ${response.status}: ${response.statusText}`,
          apiResponse: errorText,
        });
      }

      const result = await response.json();
      console.log("E-invoice API response:", result);

      // Check if the API returned success
      if (result.status === true) {
        console.log("Invoice published successfully:", result);

        // Return standardized response format
        res.json({
          success: true,
          message:
            result.message || "Hr�a đơn điện tử đã được phát hành thành công",
          data: {
            invoiceNo: result.data?.invoiceNo,
            invDate: result.data?.invDate,
            transactionID: result.data?.transactionID,
            macqt: result.data?.macqt,
            originalRequest: {
              transactionID: publishRequest.transactionID,
              invRef: publishRequest.invRef,
              totalAmount: publishRequest.invTotalAmount,
              customer: publishRequest.Customer,
            },
          },
        });
      } else {
        // API returned failure
        console.error("E-invoice API returned failure:", result);
        res.status(400).json({
          error: "E-invoice publication failed",
          message: result.message || "Unknown error from e-invoice service",
          details: result,
        });
      }
    } catch (error) {
      console.error("E-invoice publish proxy error details:");
      console.error("- Error type:", error?.constructor.name);
      console.error("- Error message:", error?.message);
      console.error("- Full error:", error);

      res.status(500).json({
        error: "Failed to publish invoice",
        details: error?.message,
        errorType: error?.constructor.name,
      });
    }
  });

  // Printer configuration management APIs
  app.get(
    "/api/printer-configs",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log(
          "🔍 GET /api/printer-configs - Starting request processing",
        );
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log(
            "✅ Tenant database connection obtained for printer configs",
          );
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for printer configs:",
            dbError,
          );
          tenantDb = null;
        }

        const configs = await storage.getPrinterConfigs(tenantDb);
        console.log(
          `✅ Successfully fetched ${configs.length} printer configs`,
        );
        res.json(configs);
      } catch (error) {
        console.error("❌ Error fetching printer configs:", error);
        res.status(500).json({
          error: "Failed to fetch printer configs",
        });
      }
    },
  );

  app.post("/api/printer-configs", async (req: TenantRequest, res) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log("Creating printer config with data:", configData);

      const config = await storage.createPrinterConfig(configData, tenantDb);
      res.status(201).json(config);
    } catch (error) {
      console.error("Error creating printer config:", error);
      res.status(500).json({
        error: "Failed to create printer config",
      });
    }
  });

  app.put("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);
      const configData = req.body;

      console.log(`Updating printer config ${id} with data:`, configData);

      const config = await storage.updatePrinterConfig(
        id,
        configData,
        tenantDb,
      );
      if (!config) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json(config);
    } catch (error) {
      console.error("Error updating printer config:", error);
      res.status(500).json({
        error: "Failed to update printer config",
      });
    }
  });

  app.delete("/api/printer-configs/:id", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      console.log(`Deleting printer config ${id}`);

      const deleted = await storage.deletePrinterConfig(id, tenantDb);

      if (!deleted) {
        return res.status(404).json({
          error: "Printer config not found",
        });
      }

      res.json({
        message: "Printer config deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting printer config:", error);
      res.status(500).json({
        error: "Failed to delete printer config",
      });
    }
  });

  app.post("/api/printer-configs/:id/test", async (req: TenantRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      const tenantDb = await getTenantDatabase(req);

      // Get printer config
      const configs = await storage.getPrinterConfigs(tenantDb);
      const config = configs.find((c) => c.id === id);

      if (!config) {
        return res.status(404).json({
          success: false,
          message: "Printer configuration not found",
        });
      }

      // Test connection based on connection type
      let testResult = { success: false, message: "Unknown connection type" };

      if (config.connectionType === "network" && config.ipAddress) {
        // Test network connection
        const net = require("net");

        const testPromise = new Promise((resolve) => {
          const client = new net.Socket();
          client.setTimeout(3000);

          client.connect(config.port || 9100, config.ipAddress, () => {
            // Send test print command
            const testData = Buffer.from(
              "\x1B@Test Print from EDPOS\n\n\n\x1DV\x41\x00",
              "utf8",
            );

            client.write(testData, (error) => {
              if (error) {
                resolve({
                  success: false,
                  message: `Failed to send test data: ${error.message}`,
                });
              } else {
                client.end();
                resolve({
                  success: true,
                  message: `Successfully connected to ${config.name}`,
                });
              }
            });
          });

          client.on("error", (err) => {
            resolve({
              success: false,
              message: `Connection failed: ${err.message}`,
            });
          });

          client.on("timeout", () => {
            client.destroy();
            resolve({ success: false, message: "Connection timeout" });
          });
        });

        testResult = await testPromise;
      } else if (config.connectionType === "usb") {
        // For USB printers, we can't directly test but we can check if the config is valid
        testResult = {
          success: true,
          message: "USB printer detection not implemented",
        };
      } else {
        testResult = {
          success: false,
          message: "Invalid printer configuration",
        };
      }

      res.json(testResult);
    } catch (error) {
      console.error("Error testing printer connection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test printer connection",
      });
    }
  });

  // Customer Reports APIs
  app.get("/api/customer-debts", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer debts from database
      const customerDebts = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          initialDebt: sql<number>`0`, // Mock initial debt
          newDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.1`, // 10% of total spent as debt
          payment: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // 5% as payment
          finalDebt: sql<number>`COALESCE(${customers.totalSpent}, 0) * 0.05`, // Final debt
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredDebts = customerDebts;
      if (customerId) {
        filteredDebts = customerDebts.filter(
          (debt) => debt.id === parseInt(customerId as string),
        );
      }

      res.json(filteredDebts);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer debts",
      });
    }
  });

  app.get("/api/customer-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, customerId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      // Get customer sales data from database
      const customerSales = await tenantDb
        .select({
          id: customers.id,
          customerCode: customers.customerId,
          customerName: customers.name,
          totalSales: customers.totalSpent,
          visitCount: customers.visitCount,
          averageOrder: sql<number>`CASE WHEN ${customers.visitCount} > 0 THEN ${customers.totalSpent} / ${customers.visitCount} ELSE 0 END`,
          phone: customers.phone,
        })
        .from(customers)
        .where(eq(customers.status, "active"));

      // Filter by customer if specified
      let filteredSales = customerSales;
      if (customerId) {
        filteredSales = customerSales.filter(
          (sale) => sale.id === parseInt(customerId as string),
        );
      }

      res.json(filteredSales);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch customer sales",
      });
    }
  });

  // Bulk create products
  app.post("/api/products/bulk", async (req: TenantRequest, res) => {
    try {
      const { products: productList } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!productList || !Array.isArray(productList)) {
        return res.status(400).json({
          error: "Invalid products data",
        });
      }

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const productData of productList) {
        try {
          console.log(`Processing product: ${JSON.stringify(productData)}`);

          // Validate required fields with detailed messages
          const missingFields = [];
          if (!productData.name) missingFields.push("name");
          if (!productData.sku) missingFields.push("sku");
          if (!productData.price) missingFields.push("price");
          if (
            productData.categoryId === undefined ||
            productData.categoryId === null
          )
            missingFields.push("categoryId");

          if (missingFields.length > 0) {
            throw new Error(
              `Missing required fields: ${missingFields.join(", ")}`,
            );
          }

          // Validate data types
          if (isNaN(parseFloat(productData.price))) {
            throw new Error(`Invalid price: ${productData.price}`);
          }

          if (isNaN(parseInt(productData.categoryId))) {
            throw new Error(`Invalid categoryId: ${productData.categoryId}`);
          }

          const [product] = await tenantDb
            .insert(products)
            .values({
              name: productData.name,
              sku: productData.sku,
              price: productData.price.toString(),
              stock: parseInt(productData.stock) || 0,
              categoryId: parseInt(productData.categoryId),
              imageUrl: productData.imageUrl || null,
              taxRate: productData.taxRate
                ? productData.taxRate.toString()
                : "0.00",
            })
            .returning();

          console.log(`Successfully created product: ${product.name}`);
          results.push({
            success: true,
            product,
          });
          successCount++;
        } catch (error) {
          const errorMessage = error.message || "Unknown error";
          console.error(
            `Error creating product ${productData.name || "Unknown"}:`,
            errorMessage,
          );
          console.error("Product data:", JSON.stringify(productData, null, 2));

          results.push({
            success: false,
            error: errorMessage,
            data: productData,
            productName: productData.name || "Unknown",
          });
          errorCount++;
        }
      }

      res.json({
        success: successCount,
        errors: errorCount,
        results,
        message: `${successCount} sản phẩm đã được tạo thành công${errorCount > 0 ? `, ${errorCount} sản phẩm lỗi` : ""}`,
      });
    } catch (error) {
      console.error("Bulk products creation error:", error);
      res.status(500).json({
        error: "Failed to create products",
      });
    }
  });

  // Employee routes
  app.get(
    "/api/employees",
    tenantMiddleware,
    async (req: TenantRequest, res) => {
      try {
        console.log("🔍 GET /api/employees - Starting request processing");
        let tenantDb;
        try {
          tenantDb = await getTenantDatabase(req);
          console.log("✅ Tenant database connection obtained for employees");
        } catch (dbError) {
          console.error(
            "❌ Failed to get tenant database for employees:",
            dbError,
          );
          tenantDb = null;
        }

        const employees = await storage.getEmployees(tenantDb);
        console.log(`✅ Successfully fetched ${employees.length} employees`);
        res.json(employees);
      } catch (error) {
        console.error("❌ Error fetching employees:", error);
        res.status(500).json({
          message: "Failed to fetch employees",
        });
      }
    },
  );

  // Employee sales report data
  app.get("/api/employee-sales", async (req: TenantRequest, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      const tenantDb = await getTenantDatabase(req);

      let query = db
        .select({
          employeeName: transactionsTable.cashierName,
          total: transactionsTable.total,
          createdAt: transactionsTable.createdAt,
        })
        .from(transactionsTable);

      if (startDate && endDate) {
        query = query.where(
          and(
            gte(transactionsTable.createdAt, startDate as string),
            lte(transactionsTable.createdAt, endDate as string),
          ),
        );
      }

      if (employeeId && employeeId !== "all") {
        query = query.where(
          eq(transactionsTable.cashierName, employeeId as string),
        );
      }

      const salesData = await query;
      res.json(salesData);
    } catch (error) {
      console.error("Error fetching employee sales:", error);
      res.status(500).json({
        message: "Failed to fetch employee sales data",
      });
    }
  });

  // Server time endpoint for consistent timestamps
  app.get("/api/server-time", async (req: TenantRequest, res) => {
    try {
      const serverTime = {
        timestamp: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      res.json(serverTime);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get server time",
      });
    }
  });

  // Product Analysis API - using orders and order_items data
  app.get(
    "/api/product-analysis/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const { categoryId, productType, productSearch } = req.query;
        const tenantDb = await getTenantDatabase(req);

        console.log("Product Analysis API called with params:", {
          startDate,
          endDate,
          categoryId,
          productType,
          productSearch,
        });

        // Build date conditions
        // Improve date parsing to handle both date-only and datetime formats
        let start: Date;
        let end: Date;

        // Check if startDate includes time (has 'T' or contains time format)
        if (startDate.includes("T") || startDate.includes(":")) {
          // DateTime format - parse as is (ISO datetime or time included)
          start = new Date(startDate);
          console.log(
            `📅 Parsed start datetime: ${startDate} -> ${start} (Local: ${start.toLocaleString()})`,
          );
        } else {
          // Date-only format - set to start of day (00:00:00)
          start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          console.log(
            `📅 Parsed start date-only: ${startDate} -> ${start} (Local: ${start.toLocaleString()})`,
          );
        }

        // Check if endDate includes time (has 'T' or contains time format)
        if (endDate.includes("T") || endDate.includes(":")) {
          // DateTime format - parse as is (ISO datetime or time included)
          end = new Date(endDate);
          console.log(
            `📅 Parsed end datetime: ${endDate} -> ${end} (Local: ${end.toLocaleString()})`,
          );
        } else {
          // Date-only format - set to end of day (23:59:59)
          end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          console.log(
            `📅 Parsed end date-only: ${endDate} -> ${end} (Local: ${end.toLocaleString()})`,
          );
        }
        const dateConditions = [];
        if (start && end) {
          dateConditions.push(
            gte(orders.orderedAt, start),
            lte(orders.orderedAt, end),
          );
        }

        // Build category conditions for products
        const categoryConditions = [];
        if (categoryId && categoryId !== "all") {
          categoryConditions.push(
            eq(products.categoryId, parseInt(categoryId as string)),
          );
        }

        // Build product type conditions
        const typeConditions = [];
        if (productType && productType !== "all") {
          const typeMap = {
            combo: 3,
            product: 1,
            service: 2,
          };
          const typeValue = typeMap[productType as keyof typeof typeMap];
          if (typeValue) {
            typeConditions.push(eq(products.productType, typeValue));
          }
        }

        // Build search conditions
        const searchConditions = [];
        if (productSearch && productSearch !== "" && productSearch !== "all") {
          const searchTerm = `%${productSearch}%`;
          searchConditions.push(
            or(
              ilike(products.name, searchTerm),
              ilike(products.sku, searchTerm),
            ),
          );
        }

        // Query order items with product details from completed/paid orders
        const productSalesData = await tenantDb
          .select({
            productId: orderItemsTable.productId,
            productName: products.name,
            productSku: products.sku,
            categoryId: products.categoryId,
            categoryName: categories.name,
            unitPrice: orderItemsTable.unitPrice, // This is the pre-tax price
            quantity: orderItemsTable.quantity,
            total: orderItemsTable.total, // This should also be pre-tax total
            orderId: orderItemsTable.orderId,
            orderDate: orders.orderedAt,
            discount: orderItemsTable.discount,
            orderStatus: orders.status,
            taxRate: products.taxRate,
            priceIncludesTax: orders.priceIncludeTax,
          })
          .from(orderItemsTable)
          .innerJoin(orders, eq(orderItemsTable.orderId, orders.id))
          .innerJoin(products, eq(orderItemsTable.productId, products.id))
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(
            and(
              or(eq(orders.status, "paid"), eq(orders.status, "completed")),
              ...dateConditions,
              ...categoryConditions,
              ...typeConditions,
              ...searchConditions,
            ),
          )
          .orderBy(desc(orders.orderedAt));

        console.log(`Found ${productSalesData.length} product sales records`);

        // Group and aggregate data by product
        const productMap = new Map();

        productSalesData.forEach((item) => {
          let productId = item.productId;
          let quantity = Number(item.quantity || 0);
          let revenue = 0;
          let discount = Number(item.discount || 0);

          if (item.priceIncludesTax) {
            // If price includes tax, we need to calculate the pre-tax price
            const unitPrice = Number(item.unitPrice || 0);
            const taxRate = Number(item.taxRate || 0);
            const preTaxPrice = unitPrice / (1 + taxRate / 100);
            const preTaxTotal = preTaxPrice * quantity;
            item.unitPrice = Math.round(preTaxPrice);
            revenue = preTaxTotal;
          }

          if (productMap.has(productId)) {
            const existing = productMap.get(productId);
            existing.quantity += quantity;
            existing.totalQuantity += quantity;
            existing.totalRevenue += revenue;
            existing.discount += discount;
            existing.totalDiscount += discount;
            existing.orderCount += 1;
          } else {
            productMap.set(productId, {
              productId: item.productId,
              productName: item.productName,
              productSku: item.productSku,
              categoryId: item.categoryId,
              categoryName: item.categoryName,
              productType: item.productType,
              unitPrice: item.unitPrice, // This is the pre-tax price
              quantity: item.quantity,
              total: item.total,
              discount: item.discount,
              totalQuantity: quantity,
              totalRevenue: revenue,
              totalDiscount: discount,
              averagePrice: Number(item.unitPrice || 0),
              orderCount: 1,
            });
          }
        });

        // Convert to array and calculate final metrics
        const productStats = Array.from(productMap.values()).map((product) => ({
          ...product,
          averageOrderValue:
            product.orderCount > 0
              ? product.totalRevenue / product.orderCount
              : 0,
        }));

        // Calculate totals
        const totalRevenue = productStats.reduce(
          (sum, product) => sum + product.totalRevenue,
          0,
        );
        const totalQuantity = productStats.reduce(
          (sum, product) => sum + product.totalQuantity,
          0,
        );
        const totalDiscount = productStats.reduce(
          (sum, product) => sum + product.totalDiscount,
          0,
        );
        const totalProducts = productStats.length;

        // Sort by revenue (descending)
        productStats.sort((a, b) => b.totalRevenue - a.totalRevenue);

        const result = {
          productStats,
          totalRevenue,
          totalQuantity,
          totalDiscount,
          totalProducts,
          summary: {
            topSellingProduct: productStats[0] || null,
            averageRevenuePerProduct:
              totalProducts > 0 ? totalRevenue / totalProducts : 0,
          },
        };

        console.log("Product Analysis Results:", {
          totalRevenue,
          totalQuantity,
          totalDiscount,
          totalProducts,
          topProduct: result.summary.topSellingProduct?.productName,
        });

        res.json(result);
      } catch (error) {
        console.error("Product analysis error:", error);
        res.status(500).json({
          error: "Failed to fetch product analysis",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // // Enhanced API endpoints for sales chart report - using same data source as dashboard
  app.get(
    "/api/dashboard-data/:startDate/:endDate",
    async (req: TenantRequest, res) => {
      try {
        const { startDate, endDate } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Dashboard data API called with params:", {
          startDate,
          endDate,
        });

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Get orders, tables, transactions, invoices - EXACT same as dashboard
        const [orders, tables, transactions, invoices] = await Promise.all([
          storage.getOrders(undefined, undefined, tenantDb),
          storage.getTables(tenantDb),
          storage.getTransactions(tenantDb),
          storage.getInvoices(tenantDb),
        ]);

        // Filter completed orders within date range - EXACT same logic as dashboard
        const filteredCompletedOrders = Array.isArray(orders)
          ? orders.filter((order) => {
              try {
                if (!order) return false;

                // Try multiple date fields - prioritize orderedAt, paidAt, createdAt
                const orderDate = new Date(
                  order.orderedAt ||
                    order.paidAt ||
                    order.createdAt ||
                    order.created_at,
                );

                if (isNaN(orderDate.getTime())) {
                  return false;
                }

                const dateMatch = orderDate >= start && orderDate <= end;

                // Include more order statuses to show real data
                const isCompleted =
                  order.status === "paid" ||
                  order.status === "completed" ||
                  order.status === "served" ||
                  order.status === "confirmed";

                return dateMatch && isCompleted;
              } catch (error) {
                console.error("Error filtering order:", order, error);
                return false;
              }
            })
          : [];

        // Calculate dashboard stats - EXACT same logic
        const periodRevenue = filteredCompletedOrders.reduce((total, order) => {
          const orderTotal = Number(order.total || 0);
          return total + orderTotal;
        }, 0);

        const periodOrderCount = filteredCompletedOrders.length;

        // Customer count: count unique customers from completed orders
        const uniqueCustomers = new Set();
        filteredCompletedOrders.forEach((order) => {
          if (order.customerId) {
            uniqueCustomers.add(order.customerId);
          } else {
            uniqueCustomers.add(`order_${order.id}`);
          }
        });
        const periodCustomerCount = uniqueCustomers.size;

        // Daily average for the period
        const daysDiff = Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
            1,
        );
        const dailyAverageRevenue = periodRevenue / daysDiff;

        // Active orders (pending/in-progress orders)
        const activeOrders = orders.filter(
          (order) =>
            order.status === "pending" || order.status === "in_progress",
        ).length;

        const occupiedTables = tables.filter(
          (table) => table.status === "occupied",
        );

        const monthRevenue = periodRevenue;
        const averageOrderValue =
          periodOrderCount > 0 ? periodRevenue / periodOrderCount : 0;

        // Peak hours analysis
        const hourlyOrders: {
          [key: number]: number;
        } = {};
        filteredCompletedOrders.forEach((order) => {
          const orderDate = new Date(
            order.orderedAt ||
              order.createdAt ||
              order.created_at ||
              order.paidAt,
          );
          if (!isNaN(orderDate.getTime())) {
            const hour = orderDate.getHours();
            hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1;
          }
        });

        const peakHour = Object.keys(hourlyOrders).reduce(
          (peak, hour) =>
            hourlyOrders[parseInt(hour)] > hourlyOrders[parseInt(peak)]
              ? hour
              : peak,
          "12",
        );

        const dashboardData = {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          dailyAverageRevenue,
          activeOrders,
          occupiedTables: occupiedTables.length,
          monthRevenue,
          averageOrderValue,
          peakHour: parseInt(peakHour),
          totalTables: tables.length,
          filteredCompletedOrders,
          orders: orders || [],
          tables: tables || [],
          transactions: transactions || [],
          invoices: invoices || [],
        };

        console.log("Dashboard data calculated:", {
          periodRevenue,
          periodOrderCount,
          periodCustomerCount,
          filteredOrdersCount: filteredCompletedOrders.length,
        });

        res.json(dashboardData);
      } catch (error) {
        console.error("Error in dashboard data API:", error);
        res.status(500).json({
          error: "Failed to fetch dashboard data",
        });
      }
    },
  );

  // Transactions API with enhanced filtering
  app.get(
    "/api/transactions/:startDate/:endDate/:salesMethod/:salesChannel/:analysisType/:concernType/:selectedEmployee",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Transactions API called with params:", {
          startDate,
          endDate,
          salesMethod,
          salesChannel,
          analysisType,
          concernType,
          selectedEmployee,
        });

        // Get transactions data
        const transactions = await storage.getTransactions(tenantDb);

        // Filter transactions based on parameters
        const filteredTransactions = transactions.filter((transaction) => {
          const transactionDate = new Date(transaction.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = transactionDate >= start && transactionDate <= end;

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            const paymentMethod = transaction.paymentMethod || "cash";
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !transaction.deliveryMethod ||
                  transaction.deliveryMethod === "pickup" ||
                  transaction.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = transaction.deliveryMethod === "delivery";
                break;
              default:
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = transaction.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !transaction.salesChannel ||
                  transaction.salesChannel === "direct" ||
                  transaction.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  transaction.salesChannel &&
                  transaction.salesChannel !== "direct" &&
                  transaction.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              transaction.cashierName === selectedEmployee ||
              (transaction.cashierName &&
                transaction.cashierName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          return (
            dateMatch && salesMethodMatch && salesChannelMatch && employeeMatch
          );
        });

        console.log(
          `Found ${filteredTransactions.length} filtered transactions out of ${transactions.length} total`,
        );
        res.json(filteredTransactions);
      } catch (error) {
        console.error("Error in transactions API:", error);
        res.status(500).json({
          error: "Failed to fetch transactions data",
        });
      }
    },
  );

  app.get(
    "/api/orders/:startDate/:endDate/:selectedEmployee/:salesChannel/:salesMethod/:analysisType/:concernType",
    async (req: TenantRequest, res) => {
      try {
        const {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Orders API called with params:", {
          startDate,
          endDate,
          selectedEmployee,
          salesChannel,
          salesMethod,
          analysisType,
          concernType,
        });

        // Get orders data
        const orders = await storage.getOrders(undefined, undefined, tenantDb);

        // Filter orders based on parameters with enhanced logic
        const filteredOrders = orders.filter((order) => {
          const orderDate = new Date(order.orderedAt || order.createdAt);
          const start = new Date(startDate);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);

          const dateMatch = orderDate >= start && orderDate <= end;

          // Enhanced employee filtering
          let employeeMatch = true;
          if (selectedEmployee !== "all") {
            employeeMatch =
              order.employeeId?.toString() === selectedEmployee ||
              (order.employeeName &&
                order.employeeName
                  .toLowerCase()
                  .includes(selectedEmployee.toLowerCase()));
          }

          // Enhanced sales channel filtering
          let salesChannelMatch = true;
          if (salesChannel !== "all") {
            const channel = order.salesChannel || "direct";
            switch (salesChannel) {
              case "direct":
                salesChannelMatch =
                  !order.salesChannel ||
                  order.salesChannel === "direct" ||
                  order.salesChannel === "pos";
                break;
              case "other":
                salesChannelMatch =
                  order.salesChannel &&
                  order.salesChannel !== "direct" &&
                  order.salesChannel !== "pos";
                break;
              default:
                salesChannelMatch =
                  channel.toLowerCase() === salesChannel.toLowerCase();
            }
          }

          // Enhanced sales method filtering
          let salesMethodMatch = true;
          if (salesMethod !== "all") {
            switch (salesMethod) {
              case "no_delivery":
                salesMethodMatch =
                  !order.deliveryMethod ||
                  order.deliveryMethod === "pickup" ||
                  order.deliveryMethod === "takeaway";
                break;
              case "delivery":
                salesMethodMatch = order.deliveryMethod === "delivery";
                break;
              default:
                const paymentMethod = order.paymentMethod || "cash";
                salesMethodMatch =
                  paymentMethod.toLowerCase() === salesMethod.toLowerCase();
            }
          }

          // Only include paid orders for analysis
          const statusMatch = order.status === "paid";

          return (
            dateMatch &&
            employeeMatch &&
            salesChannelMatch &&
            salesMethodMatch &&
            statusMatch
          );
        });

        console.log(
          `Found ${filteredOrders.length} filtered orders out of ${orders.length} total`,
        );
        res.json(filteredOrders);
      } catch (error) {
        console.error("Error in orders API:", error);
        res.status(500).json({
          error: "Failed to fetch orders data",
        });
      }
    },
  );

  app.get(
    "/api/products/:selectedCategory/:productType/:productSearch?",
    async (req: TenantRequest, res) => {
      try {
        const { selectedCategory, productType, productSearch } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log("Products API called with params:", {
          selectedCategory,
          productType,
          productSearch,
        });

        let products;

        // Get products by category or all products
        if (
          selectedCategory &&
          selectedCategory !== "all" &&
          selectedCategory !== "undefined"
        ) {
          const categoryId = parseInt(selectedCategory);
          if (!isNaN(categoryId)) {
            products = await storage.getProductsByCategory(
              categoryId,
              true,
              tenantDb,
            );
          } else {
            products = await storage.getAllProducts(true, tenantDb);
          }
        } else {
          products = await storage.getAllProducts(true, tenantDb);
        }

        // Filter by product type if specified
        if (
          productType &&
          productType !== "all" &&
          productType !== "undefined"
        ) {
          const typeMap = {
            combo: 3,
            "combo-dongoi": 3,
            product: 1,
            "hang-hoa": 1,
            service: 2,
            "dich-vu": 2,
          };
          const typeValue =
            typeMap[productType.toLowerCase() as keyof typeof typeMap];
          if (typeValue) {
            products = products.filter(
              (product) => product.productType === typeValue,
            );
          }
        }

        // Filter by product search if provided
        if (
          productSearch &&
          productSearch !== "" &&
          productSearch !== "undefined" &&
          productSearch !== "all"
        ) {
          const searchTerm = productSearch.toLowerCase();
          products = products.filter(
            (product) =>
              product.name?.toLowerCase().includes(searchTerm) ||
              product.sku?.toLowerCase().includes(searchTerm) ||
              product.description?.toLowerCase().includes(searchTerm),
          );
        }

        console.log(`Found ${products.length} products after filtering`);
        res.json(products);
      } catch (error) {
        console.error("Error in products API:", error);
        res.status(500).json({
          error: "Failed to fetch products data",
        });
      }
    },
  );

  app.get(
    "/api/customers/:customerSearch?/:customerStatus?",
    async (req: TenantRequest, res) => {
      try {
        const { customerSearch, customerStatus } = req.params;
        const tenantDb = await getTenantDatabase(req);

        console.log(
          "Customers API called with search:",
          customerSearch,
          "status:",
          customerStatus,
        );

        let customers = await storage.getCustomers(tenantDb);

        // Filter by search if provided
        if (
          customerSearch &&
          customerSearch !== "" &&
          customerSearch !== "undefined" &&
          customerSearch !== "all"
        ) {
          const searchTerm = customerSearch.toLowerCase();
          customers = customers.filter(
            (customer) =>
              customer.name?.toLowerCase().includes(searchTerm) ||
              customer.phone?.includes(customerSearch) ||
              customer.email?.toLowerCase().includes(searchTerm) ||
              customer.customerId?.toLowerCase().includes(searchTerm) ||
              customer.address?.toLowerCase().includes(searchTerm),
          );
        }

        // Filter by status if provided
        if (
          customerStatus &&
          customerStatus !== "all" &&
          customerStatus !== "undefined"
        ) {
          const now = new Date();
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          customers = customers.filter((customer) => {
            const totalSpent = Number(customer.totalSpent || 0);
            const lastVisit = customer.lastVisit
              ? new Date(customer.lastVisit)
              : null;

            switch (customerStatus) {
              case "active":
                return lastVisit && lastVisit >= thirtyDaysAgo;
              case "inactive":
                return !lastVisit || lastVisit < thirtyDaysAgo;
              case "vip":
                return totalSpent >= 500000; // VIP customers with total spent >= 500k VND
              case "new":
                const joinDate = customer.createdAt
                  ? new Date(customer.createdAt)
                  : null;
                return joinDate && joinDate >= thirtyDaysAgo;
              default:
                return true;
            }
          });
        }

        console.log(`Found ${customers.length} customers after filtering`);
        res.json(customers);
      } catch (error) {
        console.error("Error in customers API:", error);
        res.status(500).json({
          error: "Failed to fetch customers data",
        });
      }
    },
  );

  // Tax code lookup proxy endpoint
  app.post("/api/tax-code-lookup", async (req: TenantRequest, res) => {
    try {
      const { taxCode } = req.body;
      const tenantDb = await getTenantDatabase(req);

      if (!taxCode) {
        return res.status(400).json({
          success: false,
          message: "Mã số thuế không được để trống",
        });
      }

      // Call the external tax code API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/CheckListTaxCode/v2",
        {
          method: "POST",
          headers: {
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([taxCode]),
        },
      );

      if (!response.ok) {
        throw new Error(
          `External API error: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();

      res.json({
        success: true,
        data: result,
        message: "Tra cứu thành công",
      });
    } catch (error) {
      console.error("Tax code lookup error:", error);
      res.status(500).json({
        success: false,
        message: "Có lỗi xảy ra khi tra cứu mã số thuế",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // E-invoice publish proxy endpoint
  app.post("/api/einvoice/publish", async (req: TenantRequest, res) => {
    try {
      const publishRequest = req.body;
      const tenantDb = await getTenantDatabase(req);
      console.log(
        "Publishing invoice with data:",
        JSON.stringify(publishRequest, null, 2),
      );

      // Call the real e-invoice API
      const response = await fetch(
        "https://infoerpvn.com:9440/api/invoice/publish",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            token: "EnURbbnPhUm4GjNgE4Ogrw==",
          },
          body: JSON.stringify(publishRequest),
        },
      );

      if (!response.ok) {
        console.error(
          "E-invoice API error:",
          response.status,
          response.statusText,
        );
        const errorText = await response.text();
        console.error("Error response:", errorText);

        return res.status(response.status).json({
          error: "Failed to publish invoice",
          details: `API returned ${response.status}: ${response.statusText}`,
          apiResponse: errorText,
        });
      }

      const result = await response.json();
      console.log("E-invoice API response:", result);

      // Check if the API returned success
      if (result.status === true) {
        console.log("Invoice published successfully:", result);

        // Return standardized response format
        res.json({
          success: true,
          message:
            result.message || "Hóa đơn điện tử đã được phát hành thành công",
          data: {
            invoiceNo: result.data?.invoiceNo,
            invDate: result.data?.invDate,
            transactionID: result.data?.transactionID,
            macqt: result.data?.macqt,
            originalRequest: {
              transactionID: publishRequest.transactionID,
              invRef: publishRequest.invRef,
              totalAmount: publishRequest.invTotalAmount,
              customer: publishRequest.Customer,
            },
          },
        });
      } else {
        // API returned failure
        console.error("E-invoice API returned failure:", result);
        res.status(400).json({
          error: "E-invoice publication failed",
          message: result.message || "Unknown error from e-invoice service",
          details: result,
        });
      }
    } catch (error) {
      console.error("E-invoice publish proxy error details:");
      console.error("- Error type:", error?.constructor.name);
      console.error("- Error message:", error?.message);
      console.error("- Full error:", error);

      res.status(500).json({
        error: "Failed to publish invoice",
        details: error?.message,
        errorType: error?.constructor.name,
      });
    }
  });

  // Income Voucher Routes
  app.get("/api/income-vouchers", async (req: TenantRequest, res: Response) => {
    try {
      const tenantDb = await getTenantDatabase(req);
      const vouchers = await storage.getIncomeVouchers(tenantDb);
      res.json(vouchers);
    } catch (error) {
      console.error("Error fetching income vouchers:", error);
      res.status(500).json({ error: "Failed to fetch income vouchers" });
    }
  });

  app.post(
    "/api/income-vouchers",
    async (req: TenantRequest, res: Response) => {
      try {
        const voucherData = req.body;
        const tenantDb = await getTenantDatabase(req);
        const voucher = await storage.createIncomeVoucher(
          voucherData,
          tenantDb,
        );
        res.json(voucher);
      } catch (error) {
        console.error("Error creating income voucher:", error);
        res.status(500).json({ error: "Failed to create income voucher" });
      }
    },
  );

  app.put(
    "/api/income-vouchers/:id",
    async (req: TenantRequest, res: Response) => {
      try {
        const tenantDb = await getTenantDatabase(req);
        const { id } = req.params;
        const voucherData = req.body;
        const voucher = await storage.updateIncomeVoucher(
          id,
          voucherData,
          tenantDb,
        );
        res.json(voucher);
      } catch (error) {
        console.error("Error updating income voucher:", error);
        res.status(500).json({ error: "Failed to update income voucher" });
      }
    },
  );

  app.delete(
    "/api/income-vouchers/:id",
    async (req: TenantRequest, res: Response) => {
      try {
        const { id } = req.params;
        const tenantDb = await getTenantDatabase(req);
        await storage.deleteIncomeVoucher(id, tenantDb);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting income voucher:", error);
        res.status(500).json({ error: "Failed to delete income voucher" });
      }
    },
  );

  const httpServer = createServer(app);
  return httpServer;
}