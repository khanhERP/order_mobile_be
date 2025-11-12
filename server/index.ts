// @ts-nocheck
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
// import { setupVite, serveStatic, log } from "./vite";

const app = express();

// CORS configuration
app.use((req, res, next) => {
  // Allow requests from specific origins
  const allowedOrigins = [
    "https://demo-edpos.vercel.app",
    "http://localhost:5000",
    "http://localhost:5001",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:5001",
    "https://demo.edpos.vn",
    "https://0111156080.edpos.vn",
    "https://hazkitchen.edpos.vn",
    "https://0318225421.edpos.vn",
    "http://0108670987-001.edpos.vn",
    "https://0318671828.edpos.vn",
    "https://0108670987-001-mobile.edpos.vn",
    "https://0108670987-002-mobile.edpos.vn",
    "https://0108670987-003-mobile.edpos.vn",
    "https://0108670987-004-mobile.edpos.vn",
    "https://0108670987-005-mobile.edpos.vn",
    "https://0108670987-006-mobile.edpos.vn",
    "https://0108670987-007-mobile.edpos.vn",
    "https://0108670987-008-mobile.edpos.vn",
    "https://64071157-147f-4160-96cd-6dc099d777d2-00-1d0mzv8b48h7n.pike.replit.dev",
    "https://bad07204-3e0d-445f-a72e-497c63c9083a-00-3i4fcyhnilzoc.pike.replit.dev",
    "https://64071157-147f-4160-96cd-6dc099d777d2-00-1d0mzv8b48h7n.pike.replit.dev",
    "https://66622521-d7f0-4a33-aadd-c50d66665c71-00-wqfql649629t.pike.replit.dev",
    // Add any future Replit URLs here
  ];

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Enhanced logging for debugging
  console.log(`🔍 CORS check - Origin: ${origin}, Referer: ${referer}`);
  console.log(`🔍 Request URL: ${req.url}, Method: ${req.method}`);
  console.log(
    `🔍 User-Agent: ${req.headers["user-agent"]?.substring(0, 50)}...`,
  );

  // Always set these headers first
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-tenant-id",
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  );
  res.header("Access-Control-Allow-Credentials", "true");

  // Handle origin-specific CORS with better coverage
  if (origin) {
    // Check if origin is allowed
    const isAllowedOrigin = allowedOrigins.includes(origin);
    const isReplitDev = origin.includes(".replit.dev");
    const isVercelApp = origin.includes("demo-edpos.vercel.app");

    if (isAllowedOrigin || isReplitDev || isVercelApp) {
      res.header("Access-Control-Allow-Origin", origin);
      console.log(
        `✅ CORS allowed for origin: ${origin} (allowed: ${isAllowedOrigin}, replit: ${isReplitDev}, vercel: ${isVercelApp})`,
      );
    } else {
      // Still allow unknown origins but log them prominently
      res.header("Access-Control-Allow-Origin", origin);
      console.log(
        `⚠️ Unknown origin allowed: ${origin} - Consider adding to allowedOrigins`,
      );
    }
  } else {
    // No origin (same-origin requests)
    res.header("Access-Control-Allow-Origin", "*");
    console.log(`✅ CORS allowed for same-origin request`);
  }

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      console.log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    let message = err.message || "Internal Server Error";

    // Handle database connection errors
    if (
      message.includes("ECONNREFUSED") ||
      message.includes("connection refused")
    ) {
      message = "Database connection failed. Please check database server.";
      console.error("❌ Database connection error:", err);
    }

    // Handle database lock errors
    if (
      message.includes("INDEX_LOCKED") ||
      message.includes("database is locked")
    ) {
      message = "Database temporarily unavailable. Please try again.";
      console.log("Database lock detected, retrying...");
    }

    // Handle authentication errors
    if (
      message.includes("authentication failed") ||
      message.includes("password authentication failed")
    ) {
      message = "Database authentication failed. Please check credentials.";
      console.error("❌ Database auth error:", err);
    }

    // Handle timeout errors
    if (message.includes("timeout") || message.includes("connection timeout")) {
      message = "Database connection timeout. Please try again.";
      console.error("⏰ Database timeout error:", err);
    }

    res.status(status).json({ message });
    if (status >= 500) {
      console.error("💥 Server error:", err);
    }
  });

  // Add WebSocket popup close endpoint
  app.post("/api/popup/close", (req, res) => {
    const { success } = req.body;

    // Import and use WebSocket server
    import("./websocket-server").then((wsModule) => {
      wsModule.broadcastPopupClose(success);
    });

    res.json({ success: true, message: "Popup close signal sent" });
  });

  // Add endpoint to receive payment notification from external API
  app.post("/api/NotifyPos/ReceiveNotify", (req, res) => {
    try {
      const { TransactionUuid } = req.body;

      console.log(
        "📢 Received payment notification from API! TransactionUuid:",
        TransactionUuid,
      );

      // Broadcast payment success via WebSocket
      import("./websocket-server").then((wsModule) => {
        wsModule.broadcastPaymentSuccess(TransactionUuid);
      });

      res.json({ message: "Notification received successfully." });
    } catch (error) {
      console.error("Error processing payment notification:", error);
      res.status(500).json({ error: "Failed to process notification" });
    }
  });

  // Start WebSocket server for popup signals
  try {
    const wsModule = await import("./websocket-server");
    wsModule.initializeWebSocketServer(server);
    console.log("WebSocket server initialized on same port as HTTP server");
  } catch (error) {
    console.log(
      `Failed to start WebSocket server: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("WebSocket error details:", error);
    // Continue without WebSocket if it fails
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // if (app.get("env") === "development") {
  //   await setupVite(app, server);
  // } else {
  //   serveStatic(app);
  // }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const PORT = process.env.PORT || 5000;

  // Start server
  server.listen(
    {
      port: PORT,
      host: "0.0.0.0",
    },
    () => {
      console.log(`🚀 Server running on port ${PORT}`);

      // Initialize WebSocket server after HTTP server is running
      import("./websocket-server")
        .then((wsModule) => {
          wsModule.initializeWebSocketServer(server);
          console.log("WebSocket server initialized on same port as HTTP server");
        })
        .catch((error) => {
          console.error("Failed to initialize WebSocket server:", error);
        });
    },
  );

  server.on("error", (err: any) => {
    console.error("💥 Server error:", err);
    if (err.code === "EADDRINUSE") {
      console.log(`⚠️ Port ${PORT} is already in use`);
    }
  });
})();
