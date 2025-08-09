// user-servicessrc/server.ts
import dotenv from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import connectDB from "./config/connectDB.js";

// Load environment variables first
dotenv.config();

const PORT = process.env.PORT || 5001;
const app = express();

// CORS configuration - Make sure API Gateway can access
app.use(cors({
  origin: [
    'http://localhost:5000', // API Gateway
    'http://localhost:3000', // Frontend
    'http://localhost:3001', // Alternative frontend
    ...(process.env.CORS_ORIGIN?.split(',') || [])
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'X-Request-ID',
    'X-Gateway-Service',
    'X-Forwarded-For'
  ]
}));

// Middleware setup
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[USER-SERVICE] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`, {
    headers: {
      'x-request-id': req.headers['x-request-id'],
      'x-gateway-service': req.headers['x-gateway-service'],
      'user-agent': req.headers['user-agent'],
      'origin': req.headers['origin']
    },
    body: req.method !== 'GET' ? req.body : undefined
  });
  
  // Set response headers for debugging
  res.setHeader('X-Service', 'user-service');
  res.setHeader('X-Service-Version', '1.0.0');
  
  next();
});

// Connect to database
connectDB();

// Import routes
import authRouter from "./routes/auth.route.js";

// Setup routes
app.use('/api/v1/auth', authRouter);

// Health check endpoint - Enhanced for better monitoring
app.get('/health', (req: Request, res: Response) => {
  const healthCheck = {
    status: 'healthy',
    service: 'user-service',
    port: PORT,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: 'connected', // You can add actual DB health check here
    version: '1.0.0',
    requestId: req.headers['x-request-id']
  };
  
  console.log(`[USER-SERVICE] Health check requested from: ${req.ip || 'unknown'}`);
  res.status(200).json(healthCheck);
});

// Service info endpoint
app.get('/info', (_req: Request, res: Response) => {
  res.status(200).json({
    name: 'User Service',
    version: '1.0.0',
    description: 'User authentication and management service',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      users: '/api/v1/users'
    },
    environment: process.env.NODE_ENV || 'development',
    port: PORT
  });
});

// Test endpoint for debugging
app.get('/test', (req: Request, res: Response) => {
  res.status(200).json({
    message: 'User Service is working!',
    timestamp: new Date().toISOString(),
    headers: req.headers,
    method: req.method,
    url: req.originalUrl
  });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    message: 'User Service API',
    version: '1.0.0',
    status: 'running',
    availableEndpoints: [
      '/health',
      '/info', 
      '/test',
      '/api/v1/auth'
    ]
  });
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  console.log(`[USER-SERVICE] 404 - Endpoint not found: ${req.method} ${req.originalUrl}`);
  
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.originalUrl} not found in User Service`,
    service: 'user-service',
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      '/health',
      '/info',
      '/test', 
      '/api/v1/auth'
    ],
    requestId: req.headers['x-request-id']
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('[USER-SERVICE] Global Error:', {
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id']
  });

  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
      service: 'user-service',
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id']
    });
  }
});

// Start server with better error handling
const server = app.listen(PORT, () => {
  console.log(`
🚀 User Service started successfully!
🌐 Server running on: http://localhost:${PORT}
💚 Health Check: http://localhost:${PORT}/health
📋 Service Info: http://localhost:${PORT}/info
🧪 Test Endpoint: http://localhost:${PORT}/test
🔐 Auth Routes: http://localhost:${PORT}/api/v1/auth
Environment: ${process.env.NODE_ENV || 'development'}
Process ID: ${process.pid}
  `);
});

// Enhanced error handling for server startup
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  switch (error.code) {
    case 'EACCES':
      console.error(`[USER-SERVICE] Port ${PORT} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`[USER-SERVICE] Port ${PORT} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  console.log(`\n🛑 User Service received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    console.log('🔌 HTTP server closed.');
    
    // Close database connections here if needed
    // mongoose.connection.close();
    
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⏰ Forced shutdown due to timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('[USER-SERVICE] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('[USER-SERVICE] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});