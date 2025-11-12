// @ts-nocheck
import { Request, Response, NextFunction } from "express";
import { tenantManager } from "./tenant-manager";

export interface TenantRequest extends Request {
  tenant?: {
    subdomain: string;
    config: any;
    db: any;
    storeCode?: string;
  };
}

export function tenantMiddleware(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    // For development, allow tenant to be specified via query parameter
    let subdomain = req.query.tenant as string;
    let origin = req.headers.origin;
    origin = origin || req.headers.referer || req.headers.host || "";
    // Extract store code from domain if applicable
    let storeCode = tenantManager.extractStoreCode(origin);
    console.log("storeCode", storeCode);
    console.log("origin", origin);
    if (origin) {
      if (origin.includes("http://")) {
        origin = origin.replace("http://", "").trim();
      }

      if (origin.includes("https://")) {
        origin = origin.replace("https://", "").trim();
      }
      subdomain = origin.split(".")[0];

      if (origin.includes("replit.dev") || origin.includes("replit.co")) {
        subdomain = "demo"; // Default for development
      }

      console.log("subdomain", subdomain);
    }

    // If no tenant parameter, extract from host header
    if (!subdomain) {
      const host = req.get("host") || req.get("x-forwarded-host") || "";
      subdomain = extractSubdomain(host);
    }

    if (!subdomain) {
      return res.status(400).json({
        error: "Invalid subdomain",
        message:
          "Please access through a valid subdomain (e.g., store1.yourapp.replit.app) or add ?tenant=demo parameter",
      });
    }

    const tenantConfig = tenantManager.getTenantBySubdomain(subdomain);
    if (!tenantConfig) {
      return res.status(404).json({
        error: "Tenant not found",
        message: `Store '${subdomain}' not found`,
      });
    }

    if (!tenantConfig.isActive) {
      return res.status(403).json({
        error: "Store inactive",
        message: "This store is currently inactive",
      });
    }

    // Attach tenant info to request
    console.log(
      `🏢 Tenant middleware: ${subdomain}, Store Code: ${storeCode || "N/A"}`,
    );
    req.tenant = {
      subdomain,
      config: tenantConfig,
      db: null, // Will be loaded lazily
      storeCode: storeCode || undefined,
    };

    next();
  } catch (error) {
    console.error("Tenant middleware error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function extractSubdomain(host: string): string | null {
  // Remove port if present
  const hostWithoutPort = host.split(":")[0];

  // Handle development environment (Replit)
  if (
    hostWithoutPort.includes("replit.dev") ||
    hostWithoutPort.includes("replit.co")
  ) {
    // Format: c2bc841a-a304-4215-98b0-ab6349baf209-00-21m0gfgjl6ikj.worf.replit.dev
    // For replit dev URLs, we'll look for URL parameters or use a default
    return "demo"; // Default for development
  }

  // Handle production custom domain with subdomain
  if (hostWithoutPort.includes("replit.app")) {
    // Format: subdomain.appname.replit.app
    const parts = hostWithoutPort.split(".");
    if (parts.length >= 3) {
      return parts[0];
    }
  }

  // Handle custom domain with subdomain
  const parts = hostWithoutPort.split(".");
  if (parts.length >= 2) {
    const subdomain = parts[0];
    // Skip www prefix
    if (subdomain === "www") {
      return "demo"; // Default when www is used
    }
    return subdomain;
  }

  return "demo"; // Default subdomain for development
}

export async function getTenantDatabase(req: TenantRequest) {
  if (!req.tenant) {
    console.error("❌ Tenant not found in request");
    throw new Error("Tenant not found in request");
  }

  if (!req.tenant.db) {
    console.log(
      `🔍 Getting database connection for tenant: ${req.tenant.subdomain}`,
    );
    try {
      // Import database manager
      const { getTenantDatabase } = await import("./db");
      req.tenant.db = getTenantDatabase(req.tenant.subdomain);

      // Validate the database connection
      if (!req.tenant.db) {
        console.error(
          "❌ Database connection is null for tenant:",
          req.tenant.subdomain,
        );
        throw new Error("Failed to establish database connection");
      }

      // Check if database has required methods
      if (typeof req.tenant.db.select !== "function") {
        console.error(
          "❌ Database connection is missing select method for tenant:",
          req.tenant.subdomain,
        );
        throw new Error("Invalid database connection - missing select method");
      }

      console.log("✅ Tenant database connection validated successfully");
    } catch (error) {
      console.error("❌ Error getting tenant database connection:", error);
      throw error;
    }
  }

  return req.tenant.db;
}
