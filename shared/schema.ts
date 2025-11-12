// @ts-nocheck
import {
  pgTable,
  text,
  serial,
  decimal,
  integer,
  timestamp,
  boolean,
  varchar,
  date,
  numeric, // Import numeric
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { relations, sql } from "drizzle-orm";
import { z } from "zod";
import { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull(),
  storeCode: varchar("store_code", { length: 50 }),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  price: decimal("price", { precision: 18, scale: 2 }).notNull(),
  stock: integer("stock").notNull().default(0),
  categoryId: integer("category_id")
    .references(() => categories.id)
    .notNull(),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  productType: integer("product_type").notNull().default(1),
  trackInventory: boolean("track_inventory").notNull().default(true),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 })
    .notNull()
    .default("0.00"),
  taxRateName: text("tax_rate_name"), // Stores display name like "KCT", "KKKNT", "0%", "8%"
  priceIncludesTax: boolean("price_includes_tax").notNull().default(false),
  afterTaxPrice: decimal("after_tax_price", { precision: 18, scale: 2 }),
  beforeTaxPrice: decimal("before_tax_price", { precision: 18, scale: 2 }),
  floor: varchar("floor", { length: 50 }).default("1"),
  zone: varchar("zone", { length: 50 }).default("A"),
  unit: text("unit").default("Cái"),
  sort: integer("sort").default(0),
  isActive: boolean("is_active").notNull().default(true),
  storeCode: varchar("store_code", { length: 50 }),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  transactionId: text("transaction_id").notNull().unique(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(),
  amountReceived: decimal("amount_received", { precision: 10, scale: 2 }),
  change: decimal("change", { precision: 10, scale: 2 }),
  cashierName: text("cashier_name").notNull(),
  notes: text("notes"),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const transactionItems = pgTable("transaction_items", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id")
    .references(() => transactions.id)
    .notNull(),
  productId: integer("product_id")
    .references(() => products.id)
    .notNull(),
  productName: text("product_name").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  storeCode: varchar("store_code", { length: 50 }),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeId: text("employee_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role").notNull(), // "manager", "cashier", "admin"
  isActive: boolean("is_active").notNull().default(true),
  hireDate: timestamp("hire_date", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  storeCode: varchar("store_code", { length: 50 }),
});

export const attendanceRecords = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id")
    .references(() => employees.id)
    .notNull(),
  clockIn: timestamp("clock_in", { withTimezone: true }).notNull(),
  clockOut: timestamp("clock_out", { withTimezone: true }),
  breakStart: timestamp("break_start", { withTimezone: true }),
  breakEnd: timestamp("break_end", { withTimezone: true }),
  totalHours: decimal("total_hours", { precision: 4, scale: 2 }),
  overtime: decimal("overtime", { precision: 4, scale: 2 }).default("0.00"),
  status: text("status").notNull().default("present"), // "present", "absent", "late", "half_day"
  notes: text("notes"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const storeSettings = pgTable("store_settings", {
  id: serial("id").primaryKey(),
  storeName: text("store_name").notNull().default("EDPOS 레스토랑"),
  storeCode: text("store_code"),
  domain: text("domain"), // Added domain field
  taxId: text("tax_id"),
  priceListId: integer("price_list_id").references(() => priceLists.id),
  businessType: text("business_type").default("restaurant"),
  pinCode: text("pin_code"),
  userName: text("user_name"),
  password: text("password"),
  isAdmin: boolean("is_admin").default(false),
  parent: text("parent"),
  typeUser: integer("type_user").default(0),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  openTime: text("open_time").default("09:00"),
  closeTime: text("close_time").default("22:00"),
  goldThreshold: text("gold_threshold").default("300000"),
  vipThreshold: text("vip_threshold").default("1000000"),
  priceIncludesTax: boolean("price_includes_tax").default(false),
  defaultFloor: text("default_floor").default("1"),
  defaultZone: text("default_zone").default("A"),
  floorPrefix: text("floor_prefix").default("층"),
  zonePrefix: text("zone_prefix").default("구역"),
  isEdit: boolean("is_edit").notNull().default(false),
  isCancelled: boolean("is_cancelled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  taxId: text("tax_id"),
  bankAccount: text("bank_account"),
  paymentTerms: text("payment_terms").default("30일"), // "30일", "60일", "현금" 등
  status: text("status").notNull().default("active"), // "active", "inactive"
  notes: text("notes"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const purchaseReceipts = pgTable("purchase_receipts", {
  id: serial("id").primaryKey(),
  receiptNumber: text("receipt_number").notNull().unique(),
  supplierId: integer("supplier_id")
    .references(() => suppliers.id)
    .notNull(),
  employeeId: integer("employee_id").references(() => employees.id),
  purchaseDate: date("purchase_date"),
  actualDeliveryDate: date("actual_delivery_date"),
  purchaseType: text("purchase_type"), // raw_materials, expenses, others
  subtotal: decimal("subtotal", { precision: 18, scale: 2 })
    .notNull()
    .default("0.00"),
  tax: decimal("tax", { precision: 18, scale: 2 }).notNull().default("0.00"),
  total: decimal("total", { precision: 18, scale: 2 })
    .notNull()
    .default("0.00"),
  isPaid: boolean("is_paid").notNull().default(false),
  paymentMethod: text("payment_method"),
  paymentAmount: decimal("payment_amount", { precision: 18, scale: 2 }),
  notes: text("notes"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const purchaseReceiptItems = pgTable("purchase_receipt_items", {
  id: serial("id").primaryKey(),
  purchaseReceiptId: integer("purchase_receipt_id")
    .references(() => purchaseReceipts.id)
    .notNull(),
  productId: integer("product_id").references(() => products.id),
  productName: text("product_name").notNull(),
  sku: text("sku"),
  quantity: integer("quantity").notNull(),
  receivedQuantity: integer("received_quantity").notNull().default(0),
  unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(),
  total: decimal("total", { precision: 15, scale: 2 }).notNull(),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("0.00"),
  discountPercent: decimal("discount_percent", {
    precision: 5,
    scale: 2,
  }).default("0.00"),
  discountAmount: decimal("discount_amount", {
    precision: 15,
    scale: 2,
  }).default("0.00"),
  rowOrder: integer("row_order").default(0),
  notes: text("notes"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const purchaseReceiptDocuments = pgTable("purchase_receipt_documents", {
  id: serial("id").primaryKey(),
  purchaseReceiptId: integer("purchase_receipt_id")
    .references(() => purchaseReceipts.id)
    .notNull(),
  fileName: text("file_name").notNull(),
  originalFileName: text("original_file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  filePath: text("file_path").notNull(),
  description: text("description"),
  uploadedBy: integer("uploaded_by").references(() => employees.id),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  tableNumber: varchar("table_number", { length: 50 }).notNull(),
  capacity: integer("capacity").default(4),
  status: varchar("status", { length: 20 }).default("available"),
  floor: varchar("floor", { length: 50 }).default("1"), // Added floor field
  zone: varchar("zone", { length: 50 }).default("A"), // Added zone field
  qrCode: text("qr_code"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  tableId: integer("table_id").references(() => tables.id),
  employeeId: integer("employee_id").references(() => employees.id),
  customerId: integer("customer_id").references(() => customers.id), // Add customerId field
  status: text("status").notNull().default("pending"), // "pending", "confirmed", "preparing", "ready", "served", "paid", "cancelled"
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"), // Add customer phone field
  customerTaxCode: text("customer_tax_code"), // Add customer tax code field
  customerCount: integer("customer_count").default(1),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0.00"),
  discount: decimal("discount", { precision: 10, scale: 2 })
    .notNull()
    .default("0.00"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method"), // "cash", "card", "mobile", "einvoice"
  paymentStatus: text("payment_status").notNull().default("pending"), // "pending", "paid", "refunded"
  isPaid: boolean("is_paid").notNull().default(false), // Payment status flag
  einvoiceStatus: integer("einvoice_status").notNull().default(0), // 0=Chưa phát hành, 1=Đã phát hành, 2=Tạo nháp, 3=Đã duyệt, 4=Đã bị thay thế (hủy), 5=Thay thế tạm, 6=Thay thế, 7=Đã bị điều chỉnh, 8=Điều chỉnh tạm, 9=Điều chỉnh, 10=Đã hủy
  templateNumber: varchar("template_number", { length: 50 }),
  symbol: varchar("symbol", { length: 20 }),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  salesChannel: text("sales_channel").notNull().default("table"), // "table", "pos", "online", "delivery"
  priceIncludeTax: boolean("price_include_tax").notNull().default(false),
  notes: text("notes"),
  storeCode: varchar("store_code", { length: 50 }),
  orderedAt: timestamp("ordered_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  servedAt: timestamp("served_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .references(() => orders.id)
    .notNull(),
  productId: integer("product_id")
    .references(() => products.id)
    .notNull(),
  quantity: numeric("quantity", { precision: 8, scale: 4 })
    .notNull()
    .default("0.00"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 10, scale: 2 })
    .notNull()
    .default("0.00"),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0.00"),
  priceBeforeTax: decimal("price_before_tax", { precision: 10, scale: 2 })
    .notNull()
    .default("0.00"),
  status: varchar("status", { length: 50 }).notNull().default(""), // "", "pending", "progress", "completed"
  notes: text("notes"), // special requests
  storeCode: varchar("store_code", { length: 50 }),
});

export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
});

export const insertProductSchema = createInsertSchema(products)
  .omit({
    id: true,
  })
  .extend({
    price: z
      .union([z.string(), z.number()])
      .refine(
        (val) => {
          const numVal =
            typeof val === "string" ? parseFloat(val) : Number(val);
          return !isNaN(numVal) && numVal >= 0 && numVal < 100000000;
        },
        {
          message: "Price must be a non-negative number less than 100,000,000",
        },
      )
      .default("0"),
    stock: z.number().min(0, "Stock cannot be negative"),
    productType: z.number().min(1).max(4, "Product type is required"),
    taxRate: z.union([z.string(), z.number()]).transform((val) => {
      // Handle special tax rate values
      if (val === "KCT" || val === "KKKNT") {
        return "0"; // Store as "0" for database, taxRateName will store the display value
      }

      // Accept integer percentage values: 0, 5, 8, 10
      const numVal = typeof val === "string" ? parseFloat(val) : val;

      if (isNaN(numVal) || numVal < 0 || numVal > 100) {
        throw new Error("Tax rate must be between 0 and 100");
      }

      // Return as integer string (no decimals)
      return Math.floor(numVal).toString();
    }),
    taxRateName: z.string().optional(), // Added taxRateName to schema
    priceIncludesTax: z.boolean().optional().default(false),
    afterTaxPrice: z
      .union([z.string(), z.number(), z.null(), z.undefined()])
      .optional()
      .refine(
        (val) => {
          if (!val || val === null || val === undefined) return true;
          if (typeof val === "string" && val.trim() === "") return true;
          const numVal =
            typeof val === "string"
              ? parseFloat(val.replace(/[^0-9.-]/g, ""))
              : val;
          return !isNaN(numVal) && numVal >= 0;
        },
        {
          message: "After tax price must be a non-negative number",
        },
      ),
    beforeTaxPrice: z
      .union([z.string(), z.number(), z.null(), z.undefined()])
      .optional()
      .refine(
        (val) => {
          if (!val || val === null || val === undefined) return true;
          const numVal = typeof val === "string" ? parseFloat(val) : val;
          return !isNaN(numVal) && numVal >= 0;
        },
        {
          message: "Before tax price must be a positive number",
        },
      ),
    sku: z.string().optional(),
    name: z.string().min(1, "Product name is required"),
    categoryId: z.number().min(1, "Category is required"),
    floor: z.union([z.string(), z.number()]).optional().default("1"),
    zone: z.union([z.string(), z.number()]).optional().default("A"),
    unit: z.string().optional(),
    isActive: z.boolean().optional().default(true),
  });

export const insertTransactionSchema = createInsertSchema(transactions)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    invoiceId: z.number().nullable().optional(),
    invoiceNumber: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    orderId: z.number().nullable().optional(),
  });

export const insertTransactionItemSchema = createInsertSchema(
  transactionItems,
).omit({
  id: true,
  transactionId: true,
});

export const insertEmployeeSchema = createInsertSchema(employees)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    name: z.string().min(1, "Tên nhân viên là bắt buộc"),
    role: z.enum(["manager", "cashier", "admin"], {
      errorMap: () => ({ message: "Role must be manager, cashier, or admin" }),
    }),
    hireDate: z.coerce.date(),
  });

export const insertAttendanceSchema = createInsertSchema(attendanceRecords)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    status: z.enum(["present", "absent", "late", "half_day"], {
      errorMap: () => ({
        message: "Status must be present, absent, late, or half_day",
      }),
    }),
  });

export const insertTableSchema = createInsertSchema(tables)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    status: z.enum(["available", "occupied", "reserved", "maintenance"], {
      errorMap: () => ({
        message: "Status must be available, occupied, reserved, or maintenance",
      }),
    }),
    floor: z.string().optional().default("1"),
  });

export const insertOrderSchema = createInsertSchema(orders)
  .omit({
    id: true,
    orderedAt: true,
  })
  .extend({
    tableId: z.number().nullable().optional(),
    customerId: z.number().nullable().optional(), // Added customerId to InsertOrder schema
    status: z.enum(
      [
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "served",
        "paid",
        "cancelled",
      ],
      {
        errorMap: () => ({ message: "Invalid order status" }),
      },
    ),
    paymentMethod: z.string().nullable().optional(),
    paymentStatus: z.enum(["pending", "paid", "refunded"], {
      errorMap: () => ({ message: "Invalid payment status" }),
    }),
    einvoiceStatus: z.number().min(0).max(10).optional().default(0),
    salesChannel: z
      .enum(["table", "pos", "online", "delivery"])
      .optional()
      .default("table"),
    priceIncludeTax: z.boolean().optional().default(false),
    paidAt: z
      .union([z.date(), z.string().datetime()])
      .optional()
      .transform((val) => {
        if (typeof val === "string") {
          return new Date(val);
        }
        return val;
      }),
  });

export const insertOrderItemSchema = createInsertSchema(orderItems)
  .omit({
    id: true,
    orderId: true,
  })
  .extend({
    discount: z.string().optional().default("0.00"),
    status: z.enum(["", "pending", "progress", "completed"]).optional().default(""),
  });

export const insertStoreSettingsSchema = createInsertSchema(storeSettings)
  .omit({
    id: true,
    updatedAt: true,
    createdAt: true,
  })
  .extend({
    domain: z.string().optional(), // Added domain to schema
    priceIncludesTax: z.boolean().optional().default(false),
    defaultFloor: z.string().optional().default("1"),
    enableMultiFloor: z.boolean().optional().default(false),
    floorPrefix: z.string().optional().default("층"),
    isEdit: z.boolean().optional().default(false),
    isCancelled: z.boolean().optional().default(false),
  });

export const insertSupplierSchema = createInsertSchema(suppliers)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    status: z.enum(["active", "inactive"], {
      errorMap: () => ({ message: "Status must be active or inactive" }),
    }),
    email: z
      .string()
      .email("Invalid email format")
      .optional()
      .or(z.literal("")),
  });

export const insertPurchaseReceiptSchema = createInsertSchema(purchaseReceipts)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    purchaseDate: z.string().optional(),
    actualDeliveryDate: z.string().optional(),
    purchaseType: z.string().optional(),
    subtotal: z
      .string()
      .refine((val) => !isNaN(Number(val)) && Number(val) >= 0, {
        message: "Subtotal must be a positive number",
      }),
    tax: z.string().refine((val) => !isNaN(Number(val)) && Number(val) >= 0, {
      message: "Tax must be a positive number",
    }),
    total: z.string().refine((val) => !isNaN(Number(val)) && Number(val) >= 0, {
      message: "Total must be a positive number",
    }),
    isPaid: z.boolean().optional().default(false),
    paymentMethod: z.string().optional(),
    paymentAmount: z.string().optional(),
  });

export const insertPurchaseReceiptItemSchema = createInsertSchema(
  purchaseReceiptItems,
)
  .omit({
    id: true,
    purchaseReceiptId: true,
  })
  .extend({
    quantity: z.number().min(1, "Quantity must be at least 1"),
    receivedQuantity: z.number().min(0, "Received quantity cannot be negative"),
    unitPrice: z
      .string()
      .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
        message: "Unit price must be a positive number",
      }),
    total: z.string().refine((val) => !isNaN(Number(val)) && Number(val) >= 0, {
      message: "Total must be a positive number",
    }),
    discountPercent: z.string().optional().default("0.00"),
    discountAmount: z.string().optional().default("0.00"),
    rowOrder: z.number().optional().default(0),
  });

export const insertPurchaseReceiptDocumentSchema = createInsertSchema(
  purchaseReceiptDocuments,
)
  .omit({
    id: true,
    purchaseReceiptId: true,
    createdAt: true,
  })
  .extend({
    fileSize: z.number().min(0, "File size cannot be negative"),
  });

export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type TransactionItem = typeof transactionItems.$inferSelect;
export type Employee = InferSelectModel<typeof employees>;
export type InsertEmployee = InferInsertModel<typeof employees>;
export type PurchaseReceipt = typeof purchaseReceipts.$inferSelect;
export type PurchaseReceiptItem = typeof purchaseReceiptItems.$inferSelect;
export type PurchaseReceiptDocument =
  typeof purchaseReceiptDocuments.$inferSelect;

// Customers table
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  customerId: text("customer_id").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  taxCode: text("tax_code"),
  points: integer("points").default(0),
  membershipTier: text("membership_tier").default("bronze"),
  membershipLevel: text("membership_level").default("BRONZE"), // 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'
  totalSpent: decimal("total_spent", { precision: 12, scale: 2 }).default("0"),
  lastVisit: text("last_visit"),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Point transactions table for tracking point history
export const pointTransactions = pgTable("point_transactions", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id")
    .references(() => customers.id)
    .notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'earned', 'redeemed', 'adjusted', 'expired'
  points: integer("points").notNull(), // positive for earned, negative for redeemed
  description: text("description").notNull(),
  orderId: integer("order_id").references(() => orders.id), // when points are earned/redeemed from order
  employeeId: integer("employee_id").references(() => employees.id), // who processed the transaction
  previousBalance: integer("previous_balance").notNull(),
  newBalance: integer("new_balance").notNull(),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customers)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    email: z
      .string()
      .email("Invalid email format")
      .optional()
      .or(z.literal("")),
    membershipLevel: z
      .enum(["BRONZE", "SILVER", "GOLD", "PLATINUM"])
      .optional(),
    status: z.enum(["active", "inactive"]).optional(),
  });

export const insertPointTransactionSchema = createInsertSchema(
  pointTransactions,
)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    type: z.enum(["earned", "redeemed", "adjusted", "expired"], {
      errorMap: () => ({
        message: "Type must be earned, redeemed, adjusted, or expired",
      }),
    }),
  });

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .references(() => products.id)
    .notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'add', 'subtract', 'set', 'sale', 'return'
  quantity: integer("quantity").notNull(),
  previousStock: integer("previous_stock").notNull(),
  newStock: integer("new_stock").notNull(),
  notes: text("notes"),
  invoiceId: integer("invoice_id"),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: varchar("created_at", { length: 50 }).notNull(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  tradeNumber: varchar("trade_number", { length: 50 }).unique(),
  templateNumber: varchar("template_number", { length: 50 }),
  symbol: varchar("symbol", { length: 20 }),
  customerId: integer("customer_id").references(() => customers.id),
  customerName: varchar("customer_name", { length: 100 }).notNull(),
  customerTaxCode: varchar("customer_tax_code", { length: 20 }),
  customerAddress: text("customer_address"),
  customerPhone: varchar("customer_phone", { length: 20 }),
  customerEmail: varchar("customer_email", { length: 100 }),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: integer("payment_method").notNull().default(1), // 1=Tiền mặt,2=Chuyển khoản,3=TM/CK,4=Đối trừ công nợ
  invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"), // 'draft', 'published', 'cancelled'
  einvoiceStatus: integer("einvoice_status").notNull().default(0), // 0=Chưa phát hành, 1=Đã phát hành, 2=Tạo nháp, 3=Đã duyệt, 4=Đã bị thay thế (hủy), 5=Thay thế tạm, 6=Thay thế, 7=Đã bị điều chỉnh, 8=Điều chỉnh tạm, 9=Điều chỉnh, 10=Đã hủy
  invoiceStatus: integer("invoice_status").notNull().default(1), // 1=Hoàn thành, 2=Đang phục vụ, 3=Đã hủy
  notes: text("notes"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .references(() => invoices.id)
    .notNull(),
  productId: integer("product_id")
    .references(() => products.id)
    .notNull(),
  productName: varchar("product_name", { length: 200 }).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 })
    .notNull()
    .default("0.00"),
  storeCode: varchar("store_code", { length: 50 }),
});

export const eInvoiceConnections = pgTable("einvoice_connections", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  taxCode: varchar("tax_code", { length: 20 }).notNull(),
  loginId: varchar("login_id", { length: 50 }).notNull(),
  password: text("password").notNull(),
  softwareName: varchar("software_name", { length: 50 }).notNull(),
  loginUrl: text("login_url"),
  signMethod: varchar("sign_method", { length: 20 })
    .notNull()
    .default("Ký server"),
  cqtCode: varchar("cqt_code", { length: 20 }).notNull().default("Cấp nhật"),
  notes: text("notes"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  autoPublish: boolean("auto_publish").notNull().default(false),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const printerConfigs = pgTable("printer_configs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  printerType: varchar("printer_type", { length: 50 })
    .notNull()
    .default("thermal"),
  connectionType: varchar("connection_type", { length: 50 })
    .notNull()
    .default("usb"),
  ipAddress: varchar("ip_address", { length: 45 }),
  port: integer("port").default(9100),
  macAddress: varchar("mac_address", { length: 17 }),
  paperWidth: integer("paper_width").notNull().default(80),
  printSpeed: integer("print_speed").default(100),
  isEmployee: boolean("is_employee").notNull().default(false),
  isKitchen: boolean("is_kitchen").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  copies: integer("copies").notNull().default(0),
  floor: varchar("floor", { length: 50 }).default("1"),
  zone: varchar("zone", { length: 50 }).default("A"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const invoiceTemplates = pgTable("invoice_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  templateNumber: varchar("template_number", { length: 50 }).notNull(),
  templateCode: varchar("template_code", { length: 50 }),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  useCk: boolean("use_ck").notNull().default(true),
  notes: text("notes"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type PointTransaction = typeof pointTransactions.$inferSelect;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type Table = InferSelectModel<typeof tables>;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type StoreSettings = typeof storeSettings.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type InsertTransactionItem = z.infer<typeof insertTransactionItemSchema>;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type InsertTable = z.infer<typeof insertTableSchema>;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type InsertStoreSettings = z.infer<typeof insertStoreSettingsSchema>;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type InsertPointTransaction = z.infer<
  typeof insertPointTransactionSchema
>;
export type InsertPurchaseReceipt = z.infer<typeof insertPurchaseReceiptSchema>;
export type InsertPurchaseReceiptItem = z.infer<
  typeof insertPurchaseReceiptItemSchema
>;
export type InsertPurchaseReceiptDocument = z.infer<
  typeof insertPurchaseReceiptDocumentSchema
>;

export const insertEInvoiceConnectionSchema = createInsertSchema(
  eInvoiceConnections,
)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    signMethod: z.enum(["Ký server", "Ký USB Token", "Ký HSM"]).optional(),
    cqtCode: z.enum(["Cấp nhật", "Cấp hai"]).optional(),
  });

export const insertInvoiceTemplateSchema = createInsertSchema(
  invoiceTemplates,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInvoiceSchema = createInsertSchema(invoices)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    einvoiceStatus: z.number().min(0).max(10).optional().default(0),
  });

export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({
  id: true,
  invoiceId: true,
});

export type EInvoiceConnection = typeof eInvoiceConnections.$inferSelect;
export type InsertEInvoiceConnection = z.infer<
  typeof insertEInvoiceConnectionSchema
>;
export type InvoiceTemplate = typeof invoiceTemplates.$inferSelect;
export type InsertInvoiceTemplate = z.infer<typeof insertInvoiceTemplateSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;

export const insertPrinterConfigSchema = createInsertSchema(printerConfigs)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    printerType: z.enum(["thermal", "inkjet", "laser"]).optional(),
    connectionType: z.enum(["usb", "network", "bluetooth"]).optional(),
    copies: z.number().min(0).optional().default(0),
  });

export type PrinterConfig = typeof printerConfigs.$inferSelect;
export type InsertPrinterConfig = z.infer<typeof insertPrinterConfigSchema>;

// Cart item type for frontend use
export type CartItem = {
  id: number;
  name: string;
  price: string;
  quantity: number; // Supports decimal values up to 4 decimal places
  total: string;
  imageUrl?: string;
  stock: number;
  taxRate?: string;
  taxRateName?: string; // Added taxRateName to CartItem type
  afterTaxPrice?: string;
  discount?: number; // Item-level discount
};

// Relations
export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  transactionItems: many(transactionItems),
}));

export const transactionsRelations = relations(transactions, ({ many }) => ({
  items: many(transactionItems),
}));

export const transactionItemsRelations = relations(
  transactionItems,
  ({ one }) => ({
    transaction: one(transactions, {
      fields: [transactionItems.transactionId],
      references: [transactions.id],
    }),
    product: one(products, {
      fields: [transactionItems.productId],
      references: [products.id],
    }),
  }),
);

export const employeesRelations = relations(employees, ({ many }) => ({
  attendanceRecords: many(attendanceRecords),
}));

export const attendanceRecordsRelations = relations(
  attendanceRecords,
  ({ one }) => ({
    employee: one(employees, {
      fields: [attendanceRecords.employeeId],
      references: [employees.id],
    }),
  }),
);

export const tablesRelations = relations(tables, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  table: one(tables, {
    fields: [orders.tableId],
    references: [tables.id],
  }),
  employee: one(employees, {
    fields: [orders.employeeId],
    references: [employees.id],
  }),
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const orderChangeHistory = pgTable("order_change_history", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(), // IPv4 or IPv6
  userId: integer("user_id"), // Employee or user ID
  userName: varchar("user_name", { length: 255 }).notNull(),
  action: varchar("action", { length: 50 }).notNull().default("edit"), // 'edit', 'create', 'delete', 'cancel'
  detailedDescription: text("detailed_description").notNull(), // JSON string with change details
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertOrderChangeHistorySchema = createInsertSchema(
  orderChangeHistory,
)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    action: z.enum(["edit", "create", "delete", "cancel"]).default("edit"),
  });

export type OrderChangeHistory = typeof orderChangeHistory.$inferSelect;
export type InsertOrderChangeHistory = z.infer<
  typeof insertOrderChangeHistorySchema
>;

export const customersRelations = relations(customers, ({ many }) => ({
  pointTransactions: many(pointTransactions),
  orders: many(orders),
}));

export const pointTransactionsRelations = relations(
  pointTransactions,
  ({ one }) => ({
    customer: one(customers, {
      fields: [pointTransactions.customerId],
      references: [customers.id],
    }),
    order: one(orders, {
      fields: [pointTransactions.orderId],
      references: [orders.id],
    }),
    employee: one(employees, {
      fields: [pointTransactions.employeeId],
      references: [employees.id],
    }),
  }),
);

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseReceipts: many(purchaseReceipts),
}));

export const purchaseReceiptsRelations = relations(
  purchaseReceipts,
  ({ one, many }) => ({
    supplier: one(suppliers, {
      fields: [purchaseReceipts.supplierId],
      references: [suppliers.id],
    }),
    employee: one(employees, {
      fields: [purchaseReceipts.employeeId],
      references: [employees.id],
    }),
    items: many(purchaseReceiptItems),
    documents: many(purchaseReceiptDocuments),
  }),
);

export const purchaseReceiptItemsRelations = relations(
  purchaseReceiptItems,
  ({ one }) => ({
    purchaseReceipt: one(purchaseReceipts, {
      fields: [purchaseReceiptItems.purchaseReceiptId],
      references: [purchaseReceipts.id],
    }),
    product: one(products, {
      fields: [purchaseReceiptItems.productId],
      references: [products.id],
    }),
  }),
);

export const purchaseReceiptDocumentsRelations = relations(
  purchaseReceiptDocuments,
  ({ one }) => ({
    purchaseReceipt: one(purchaseReceipts, {
      fields: [purchaseReceiptDocuments.purchaseReceiptId],
      references: [purchaseReceipts.id],
    }),
    uploadedByEmployee: one(employees, {
      fields: [purchaseReceiptDocuments.uploadedBy],
      references: [employees.id],
    }),
  }),
);

// Receipt data type
export type Receipt = Transaction & {
  items: (TransactionItem & { productName: string })[];
};

// Alias for backward compatibility - use purchase receipt schema
export const insertPurchaseOrderSchema = insertPurchaseReceiptSchema;
export const insertPurchaseOrderItemSchema = insertPurchaseReceiptItemSchema;

export const insertInventoryTransactionSchema = createInsertSchema(
  inventoryTransactions,
).omit({
  id: true,
  createdAt: true,
});

export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;
export type InsertInventoryTransaction = z.infer<
  typeof insertInventoryTransactionSchema
>;

// Purchase orders table
export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  orderNumber: varchar("order_number", { length: 50 }).notNull(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  status: varchar("status", { length: 20 }).default("pending"),
  expectedDeliveryDate: timestamp("expected_delivery_date", {
    withTimezone: true,
  }),
  notes: text("notes"),
  total: numeric("total", { precision: 10, scale: 2 }).default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(
    sql`now()`,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(
    sql`now()`,
  ),
});

// Income vouchers table
export const incomeVouchers = pgTable("income_vouchers", {
  id: serial("id").primaryKey(),
  voucherNumber: varchar("voucher_number", { length: 50 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  account: varchar("account", { length: 50 }).notNull(),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  receiverName: varchar("receiver_name", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  category: varchar("category", { length: 50 }).notNull(),
  description: text("description"),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Expense vouchers table
export const expenseVouchers = pgTable("expense_vouchers", {
  id: serial("id").primaryKey(),
  voucherNumber: varchar("voucher_number", { length: 50 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  account: varchar("account", { length: 50 }).notNull(),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  receiverName: varchar("receiver_name", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  category: varchar("category", { length: 50 }).notNull(),
  description: text("description"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Payment methods table
export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  nameKey: varchar("name_key", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  icon: text("icon").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").default(0),
  isSystem: boolean("is_system").notNull().default(false),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type IncomeVoucher = typeof incomeVouchers.$inferSelect;
export type InsertIncomeVoucher = typeof incomeVouchers.$inferInsert;

export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type InsertPaymentMethod = typeof paymentMethods.$inferInsert;

// System Users table for multi-tenant authentication
export const sysUsers = pgTable("sys_user", {
  id: serial("id").primaryKey(),
  userName: varchar("user_name", { length: 200 }).notNull(),
  password: varchar("password", { length: 200 }).notNull(),
  storeCode: varchar("store_code", { length: 50 }),
  connection: varchar("connection", { length: 1000 }).notNull(),
  storeName: varchar("storename", { length: 500 }),
  subdomain: varchar("subdomain", { length: 500 }),
  domain: varchar("domain", { length: 1000 }),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertSysUserSchema = createInsertSchema(sysUsers)
  .omit({
    id: true,
  })
  .extend({
    userName: z.string().min(1, "Username is required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    connection: z.string().min(1, "Connection string is required"),
    isActive: z.boolean().optional().default(true),
  });

export type SysUser = typeof sysUsers.$inferSelect;
export type InsertSysUser = z.infer<typeof insertSysUserSchema>;

// Price Lists table
export const priceLists = pgTable("price_lists", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Price List Items table
export const priceListItems = pgTable("price_list_items", {
  id: serial("id").primaryKey(),
  priceListId: integer("price_list_id")
    .references(() => priceLists.id, { onDelete: "cascade" })
    .notNull(),
  productId: integer("product_id")
    .references(() => products.id, { onDelete: "cascade" })
    .notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  storeCode: varchar("store_code", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertPriceListSchema = createInsertSchema(priceLists)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    code: z.string().min(1, "Mã bảng giá là bắt buộc"),
    name: z.string().min(1, "Tên bảng giá là bắt buộc"),
    isActive: z.boolean().optional().default(true),
    isDefault: z.boolean().optional().default(false),
    validFrom: z
      .union([z.string(), z.date()])
      .optional()
      .nullable()
      .transform((val) => {
        if (!val) return null;
        if (typeof val === "string") return new Date(val);
        return val;
      }),
    validTo: z
      .union([z.string(), z.date()])
      .optional()
      .nullable()
      .transform((val) => {
        if (!val) return null;
        if (typeof val === "string") return new Date(val);
        return val;
      }),
  });

export const insertPriceListItemSchema = createInsertSchema(priceListItems)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    price: z.string().refine((val) => !isNaN(Number(val)) && Number(val) >= 0, {
      message: "Giá phải là số dương",
    }),
  });

export type PriceList = typeof priceLists.$inferSelect;
export type InsertPriceList = z.infer<typeof insertPriceListSchema>;
export type PriceListItem = typeof priceListItems.$inferSelect & {
  updatedAt?: Date | string;
  createdAt?: Date | string;
};
export type InsertPriceListItem = z.infer<typeof insertPriceListItemSchema>;

// General Settings table
export const generalSettings = pgTable("general_settings", {
  id: serial("id").primaryKey(),
  settingCode: varchar("setting_code", { length: 50 }).notNull().unique(),
  settingName: varchar("setting_name", { length: 255 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertGeneralSettingSchema = createInsertSchema(generalSettings)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    settingCode: z.string().min(1, "Mã thiết lập là bắt buộc"),
    settingName: z.string().min(1, "Tên thiết lập là bắt buộc"),
    isActive: z.boolean().optional().default(true),
  });

export type GeneralSetting = typeof generalSettings.$inferSelect;
export type InsertGeneralSetting = z.infer<typeof insertGeneralSettingSchema>;
