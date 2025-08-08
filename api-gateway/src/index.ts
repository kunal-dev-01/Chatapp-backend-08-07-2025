import express, { Request, Response, NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";
import morgan from "morgan";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

// Load environment variables
dotenv.config();

import { ServiceConfig, ProxyOptions } from "./types/index.type";

class APIGateway {
  private app: express.Application;
  private port: number;
  private services: ServiceConfig[];

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || "3000", 10);
    this.services = [
      {
        name: "user-service",
        url: process.env.USER_SERVICE_URL || "http://user-service:5001",
        path: "/api/v1/auth",
        timeout: 10000,
      },
      {
        name: "user-service",
        url: process.env.USER_SERVICE_URL || "http://user-service:5001",
        path: "/api/v1/users",
        timeout: 10000,
      },
      {
        name: "user-service",
        url: process.env.USER_SERVICE_URL || "http://user-service:5001",
        path: "/api/v1/social",
        timeout: 10000,
      },
      {
        name: "chat-service",
        url: process.env.CHAT_SERVICE_URL || "http://chat-service:5002",
        path: "/api/v1/chat",
        timeout: 15000,
      },
      {
        name: "notification-service",
        url:
          process.env.NOTIFICATION_SERVICE_URL ||
          "http://notification-service:5003",
        path: "/api/v1/notifications",
        timeout: 8000,
      },
    ];

    this.setupMiddlewares();
    this.setupRoutes();
    this.setupProxies();
    this.setupErrorHandling();
  }

  private setupMiddlewares(): void {
    // Security middleware
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        },
      })
    );

    // CORS configuration
    this.app.use(
      cors({
        origin: process.env.CORS_ORIGIN?.split(",") || [
          "http://localhost:3000",
          "http://localhost:3001",
        ],
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        credentials: true,
      })
    );

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: {
        error: "Too many requests from this IP, please try again later.",
        retryAfter: 15 * 60 * 1000,
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use("/api/v1/auth", limiter);
    this.app.use("/api/v1/users", limiter);
    this.app.use("/api/v1/social", limiter);
    this.app.use("/api/v1/notifications", limiter);

    // Compression middleware
    this.app.use(compression());

    // Logging middleware
    this.app.use(morgan("combined"));

    // Trust proxy settings for proper IP detection
    this.app.set("trust proxy", true);

    // Body parsing middleware
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Request ID middleware for tracing
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.headers["x-request-id"] =
        req.headers["x-request-id"] || this.generateRequestId();
      res.setHeader("X-Request-ID", req.headers["x-request-id"] as string);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (_req: Request, res: Response) => {
      res.status(200).json({
        status: "OK",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: this.services.map((service) => ({
          name: service.name,
          url: service.url,
          path: service.path,
        })),
      });
    });

    // API documentation endpoint
    this.app.get("/api/docs", (res: Response) => {
      res.status(200).json({
        title: "Chat App API Gateway",
        version: "1.0.0",
        services: this.services,
        endpoints: {
          users: {
            base: "/api/v1/users",
            methods: ["GET", "POST", "PUT", "DELETE"],
            description: "User management service",
          },
          chat: {
            base: "/api/v1/chat",
            methods: ["GET", "POST", "PUT", "DELETE"],
            description: "Chat messaging service",
          },
          notifications: {
            base: "/api/v1/notifications",
            methods: ["GET", "POST", "PUT", "DELETE"],
            description: "Notification service",
          },
        },
      });
    });

    // Service status endpoint
    this.app.get("/api/status", async (res: Response) => {
      const serviceStatuses = await Promise.allSettled(
        this.services.map(async (service) => {
          try {
            const response = await fetch(`${service.url}/health`, {
              method: "GET",
              signal: AbortSignal.timeout(5000),
            });
            return {
              name: service.name,
              status: response.ok ? "healthy" : "unhealthy",
              url: service.url,
              responseTime: response.headers.get("x-response-time") || "N/A",
            };
          } catch (error) {
            return {
              name: service.name,
              status: "unreachable",
              url: service.url,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        })
      );

      res.status(200).json({
        gateway: "healthy",
        timestamp: new Date().toISOString(),
        services: serviceStatuses.map((result) =>
          result.status === "fulfilled" ? result.value : result.reason
        ),
      });
    });
  }

  private setupProxies(): void {
    this.services.forEach((service) => {
      const proxyOptions: ProxyOptions = {
        target: service.url,
        changeOrigin: true,
        timeout: service.timeout || 10000,
        proxyTimeout: service.timeout || 10000,
        pathRewrite: {
          [`^${service.path}`]: "",
        },
        onProxyReq: (proxyReq, req) => {
          // Add custom headers
          const clientIp =
            req.ip ||
            req.connection?.remoteAddress ||
            req.socket?.remoteAddress ||
            "unknown";
          proxyReq.setHeader("X-Forwarded-For", clientIp);
          proxyReq.setHeader("X-Gateway-Service", service.name);
          proxyReq.setHeader(
            "X-Request-ID",
            req.headers["x-request-id"] as string
          );

          console.log(
            `[PROXY] ${req.method} ${req.url} -> ${service.url}${proxyReq.path}`
          );
        },
        onProxyRes: (proxyRes) => {
          // Add service identification header
          proxyRes.headers["x-service-name"] = service.name;
          proxyRes.headers["x-gateway-version"] = "1.0.0";
        },
        onError: (err, req, res) => {
          console.error(`[PROXY ERROR] ${service.name}:`, err.message);

          if (!res.headersSent) {
            res.status(503).json({
              error: "Service Unavailable",
              message: `${service.name} is currently unavailable`,
              service: service.name,
              timestamp: new Date().toISOString(),
              requestId: req.headers["x-request-id"],
            });
          }
        },
      };

      // Create and use proxy middleware
      const proxy = createProxyMiddleware(proxyOptions);
      this.app.use(service.path, proxy);

      console.log(
        `[GATEWAY] Configured proxy: ${service.path} -> ${service.url}`
      );
    });
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use("*", (req: Request, res: Response) => {
      res.status(404).json({
        error: "Not Found",
        message: "The requested endpoint does not exist",
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
        requestId: req.headers["x-request-id"],
      });
    });

    // Global error handler
    this.app.use((err: Error, req: Request, res: Response) => {
      console.error("[GATEWAY ERROR]:", {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        requestId: req.headers["x-request-id"],
      });

      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal Server Error",
          message:
            process.env.NODE_ENV === "production"
              ? "Something went wrong"
              : err.message,
          timestamp: new Date().toISOString(),
          requestId: req.headers["x-request-id"],
        });
      }
    });
  }

  private generateRequestId(): string {
    return uuidv4();
  }

  public start(): void {
    this.app.listen(this.port, () => {
      console.log(`
🚀 API Gateway started successfully!
🌐 Server running on: http://localhost:${this.port}
📚 API Documentation: http://localhost:${this.port}/api/docs
💚 Health Check: http://localhost:${this.port}/health
🔍 Service Status: http://localhost:${this.port}/api/status

📡 Configured Services:
${this.services.map((s) => `   • ${s.name}: ${s.path} -> ${s.url}`).join("\n")}

Environment: ${process.env.NODE_ENV || "development"}
      `);
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("🛑 Received SIGTERM, shutting down gracefully...");
      process.exit(0);
    });

    process.on("SIGINT", () => {
      console.log("🛑 Received SIGINT, shutting down gracefully...");
      process.exit(0);
    });
  }
}

// Start the API Gateway
const gateway = new APIGateway();
gateway.start();
