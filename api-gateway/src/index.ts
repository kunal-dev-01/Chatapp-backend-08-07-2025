// api-gateway/src/index.ts
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

// Types
import {
  ServiceConfig,
  ProxyOptions
} from "./types/index.type";

class APIGateway {
  private app: express.Application;
  private port: number;
  private services: ServiceConfig[];

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || "5000", 10);
    
    // Detect if running in Docker environment
    const isDocker = process.env.DOCKER_ENV === 'true' || 
                    process.env.NODE_ENV === 'production' ||
                    !!process.env.KUBERNETES_SERVICE_HOST;
    
    console.log(`[GATEWAY] Environment detection: ${isDocker ? 'Docker/Container' : 'Local Development'}`);
    
    this.services = [
      {
        name: "user-service",
        url: process.env.USER_SERVICE_URL || (isDocker ? "http://user-service:5001" : "http://localhost:5001"),
        path: "/api/v1/auth",
        timeout: 30000,
      },
      {
        name: "user-service", 
        url: process.env.USER_SERVICE_URL || (isDocker ? "http://user-service:5001" : "http://localhost:5001"),
        path: "/api/v1/users",
        timeout: 30000,
      },
      {
        name: "user-service",
        url: process.env.USER_SERVICE_URL || (isDocker ? "http://user-service:5001" : "http://localhost:5001"),
        path: "/api/v1/social",
        timeout: 30000,
      },
      {
        name: "chat-service",
        url: process.env.CHAT_SERVICE_URL || (isDocker ? "http://chat-service:5002" : "http://localhost:5002"),
        path: "/api/v1/chat",
        timeout: 30000,
      },
      {
        name: "notification-service",
        url: process.env.NOTIFICATION_SERVICE_URL || (isDocker ? "http://notification-service:5003" : "http://localhost:5003"),
        path: "/api/v1/notifications",
        timeout: 30000,
      },
    ];

    console.log(`[GATEWAY] Service URLs configured:`, this.services.map(s => `${s.name}: ${s.url}`));

    this.setupMiddlewares();
    this.setupRoutes();
    this.setupProxies();
    this.setupErrorHandling();
  }

  private setupMiddlewares(): void {
    // Trust proxy settings (MUST be set before rate limiting)
    this.app.set("trust proxy", 1);

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
          "http://localhost:5000",
          "http://localhost:5001",
        ],
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        credentials: true,
      })
    );

    // Rate limiting with proper trust proxy configuration
    const createRateLimiter = (windowMs: number = 15 * 60 * 1000, max: number = 100) => {
      return rateLimit({
        windowMs,
        max,
        message: {
          error: "Too many requests from this IP, please try again later.",
          retryAfter: Math.ceil(windowMs / 1000),
        },
        standardHeaders: true,
        legacyHeaders: false,
        
        keyGenerator: (req: Request): string => {
          const forwarded = req.headers['x-forwarded-for'];
          const ip = typeof forwarded === 'string' 
            ? forwarded.split(',')[0].trim()
            : req.ip || req.socket?.remoteAddress || 'unknown';
          
          console.log(`[RATE-LIMIT] Using IP: ${ip} for request: ${req.originalUrl}`);
          return ip;
        },
      });
    };

    // Apply rate limiting to specific routes (only in production)
    if (process.env.NODE_ENV === "production") {
      this.app.use("/api/v1/auth", createRateLimiter(15 * 60 * 1000, 50));
      this.app.use("/api/v1/users", createRateLimiter());
      this.app.use("/api/v1/social", createRateLimiter());
      this.app.use("/api/v1/chat", createRateLimiter(60 * 1000, 200));
      this.app.use("/api/v1/notifications", createRateLimiter());
      
      console.log("[SECURITY] Rate limiting enabled for production");
    } else {
      console.log("[DEV] Rate limiting disabled for development");
    }

    // Compression middleware
    this.app.use(compression());

    // Logging middleware
    this.app.use(morgan("combined"));

    // Body parsing middleware
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Request ID middleware for tracing
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = (req.headers["x-request-id"] as string) || this.generateRequestId();
      req.headers["x-request-id"] = requestId;
      res.setHeader("X-Request-ID", requestId);
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
        environment: process.env.NODE_ENV || "development",
        services: this.services.map((service) => ({
          name: service.name,
          url: service.url,
          path: service.path,
        })),
      });
    });

    // API documentation endpoint
    this.app.get("/api/docs", (_req: Request, res: Response) => {
      res.status(200).json({
        title: "Chat App API Gateway",
        version: "1.0.0",
        services: this.services,
        endpoints: {
          auth: {
            base: "/api/v1/auth",
            methods: ["POST"],
            description: "Authentication service",
          },
          users: {
            base: "/api/v1/users",
            methods: ["GET", "POST", "PUT", "DELETE"],
            description: "User management service",
          },
          social: {
            base: "/api/v1/social",
            methods: ["GET", "POST", "PUT", "DELETE"],
            description: "Social features service",
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

    // Service status endpoint with enhanced health checks
    this.app.get("/api/status", async (_req: Request, res: Response) => {
      const serviceStatuses = await Promise.allSettled(
        this.services.map(async (service): Promise<{
          name: string;
          status: string;
          url: string;
          responseTime?: string;
          httpStatus?: number;
          error?: string;
          suggestion?: string;
        }> => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const startTime = Date.now();
            const response = await fetch(`${service.url}/health`, {
              method: "GET",
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'API-Gateway-Health-Check'
              }
            });
            const responseTime = Date.now() - startTime;
            
            clearTimeout(timeoutId);
            
            return {
              name: service.name,
              status: response.ok ? "healthy" : "unhealthy",
              url: service.url,
              responseTime: `${responseTime}ms`,
              httpStatus: response.status,
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[HEALTH CHECK] ${service.name} health check failed:`, errorMessage);
            
            return {
              name: service.name,
              status: "unreachable",
              url: service.url,
              error: errorMessage,
              suggestion: errorMessage.includes('EAI_AGAIN') || errorMessage.includes('ENOTFOUND') 
                ? "Service hostname cannot be resolved. Check if service is running and network configuration is correct."
                : "Service may be down or not responding.",
            };
          }
        })
      );

      const services = serviceStatuses.map((result) =>
        result.status === "fulfilled" ? result.value : result.reason
      );

      const overallHealth = services.every(s => s.status === "healthy") ? "healthy" : "degraded";

      res.status(200).json({
        gateway: overallHealth,
        timestamp: new Date().toISOString(),
        services,
      });
    });
  }

  private setupProxies(): void {
    this.services.forEach((service) => {
      const proxyOptions: ProxyOptions = {
        target: service.url,
        changeOrigin: true,
        timeout: service.timeout || 30000,
        proxyTimeout: service.timeout || 30000,
        secure: false,
        followRedirects: true,
        // 🔥 MAIN FIX: Correct pathRewrite configuration
        pathRewrite: (path: string, _req: Request) => {
          // Remove the base path and keep the rest
          const newPath = path.replace(service.path, '/api/v1' + service.path.split('/api/v1')[1]);
          console.log(`[PATH REWRITE] Original: ${path} -> Rewritten: ${newPath}`);
          return newPath;
        },
        
        onProxyReq: (proxyReq, req: Request) => {
          const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
          
          proxyReq.setHeader("X-Forwarded-For", clientIp);
          proxyReq.setHeader("X-Gateway-Service", service.name);
          proxyReq.setHeader("X-Request-ID", req.headers["x-request-id"] as string);
          proxyReq.setHeader("Host", new URL(service.url).host);
          
          // Log the proxy request
          console.log(`[PROXY] ${req.method} ${req.originalUrl} -> ${service.url}${proxyReq.path}`);
          
          // Handle body for POST/PUT requests
          if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Type', 'application/json');
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
          }
        },
        
        onProxyRes: (proxyRes) => {
          proxyRes.headers["x-service-name"] = service.name;
          proxyRes.headers["x-gateway-version"] = "1.0.0";
          
          console.log(`[PROXY RESPONSE] ${service.name} responded with status: ${proxyRes.statusCode}`);
        },
        
        onError: (err: Error, req: Request, res: Response) => {
          console.error(`[PROXY ERROR] ${service.name}:`, {
            error: err.message,
            targetUrl: service.url,
            requestUrl: req.originalUrl,
            method: req.method,
            stack: err.stack
          });

          if (!res.headersSent) {
            let suggestion = "Service may be starting up, please try again in a moment";
            let errorType = 'CONNECTION_ERROR';
            
            if (err.message.includes('EAI_AGAIN') || err.message.includes('ENOTFOUND')) {
              suggestion = process.env.NODE_ENV === "development" 
                ? "Check if your microservices are running. If using Docker, ensure services are in the same network."
                : "Service hostname cannot be resolved. Check network configuration.";
              errorType = 'DNS_RESOLUTION';
            } else if (err.message.includes('ECONNREFUSED')) {
              suggestion = "Service is not accepting connections. Check if the service is running on the correct port.";
              errorType = 'CONNECTION_REFUSED';
            } else if (err.message.includes('ETIMEDOUT') || err.message.includes('timeout')) {
              suggestion = "Service is taking too long to respond. Check service performance.";
              errorType = 'TIMEOUT';
            }

            res.status(503).json({
              error: "Service Unavailable",
              message: `${service.name} is currently unavailable.`,
              service: service.name,
              serviceUrl: service.url,
              errorType,
              timestamp: new Date().toISOString(),
              requestId: req.headers["x-request-id"],
              suggestion,
            });
          }
        },
      };

      const proxy = createProxyMiddleware(proxyOptions);
      this.app.use(service.path, proxy);

      console.log(`[GATEWAY] ✅ Configured proxy: ${service.path} -> ${service.url}`);
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
        availableEndpoints: [
          "/health",
          "/api/docs", 
          "/api/status",
          ...this.services.map(s => s.path)
        ]
      });
    });

    // Global error handler
    this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      console.error("[GATEWAY ERROR]:", {
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        requestId: req.headers["x-request-id"],
      });

      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal Server Error",
          message: process.env.NODE_ENV === "production" ? "Something went wrong" : err.message,
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
      
      // Test connectivity to services on startup
      setTimeout(() => {
        this.testServiceConnectivity();
      }, 2000);
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

  private async testServiceConnectivity(): Promise<void> {
    console.log("\n🔍 Testing service connectivity...");
    
    for (const service of this.services) {
      try {
        const response = await fetch(`${service.url}/health`, {
          method: 'GET',
        });
        
        if (response.ok) {
          console.log(`✅ ${service.name} at ${service.url} - Connected`);
        } else {
          console.log(`⚠️  ${service.name} at ${service.url} - HTTP ${response.status}`);
        }
      } catch (error) {
        const err = error as Error;
        console.log(`❌ ${service.name} at ${service.url} - ${err.message}`);
      }
    }
    console.log("");
  }
}

// Start the API Gateway
const gateway = new APIGateway();
gateway.start();