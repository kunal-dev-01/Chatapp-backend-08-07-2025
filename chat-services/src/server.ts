// services/chat-service/src/server.ts
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import connectDB from './config/connectDB.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { WebSocketManager } from './websocket/websocketManager.js';
import { AppError } from './utils/AppError.js';


// Routes
import conversationRoutes from './routes/conversation.route.js';
import messageRoutes from './routes/message.route.js';
import mediaRoutes from './routes/media.route.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ 
  server,
  path: '/ws',
  verifyClient: (info: any) => {
    // Basic verification - detailed auth happens in WebSocketManager
    return info.req.headers.cookie !== undefined || 
           info.req.headers.authorization !== undefined ||
           info.req.url.includes('token=');
  }
});

const PORT = process.env.PORT || 5002;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    process.env.API_GATEWAY_URL || 'http://localhost:5000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const rateLimitConfig = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // More lenient in dev
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', rateLimitConfig);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Global WebSocket Manager instance
let wsManager: WebSocketManager;

// Initialize connections
async function initializeServices() {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('✅ MongoDB connected');

    // Connect to Redis
    await connectRedis();
    console.log('✅ Redis connected');

    // Initialize WebSocket Manager
    wsManager = new WebSocketManager(wss);
    console.log('✅ WebSocket Manager initialized');

    // Store wsManager in app for access in routes
    app.locals.wsManager = wsManager;

  } catch (error) {
    console.error('❌ Service initialization failed:', error);
    process.exit(1);
  }
}

// API Routes
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1/media', mediaRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'Chat Service is running!',
    port: PORT,
    services: {
      mongodb: 'connected',
      redis: 'connected',
      websocket: 'active'
    },
    websocket: {
      connectedUsers: wsManager ? wsManager.getConnectedUsersCount() : 0,
      totalClients: wss.clients.size
    },
    features: {
      realTimeMessaging: true,
      fileUpload: true,
      mediaProcessing: true,
      messageReactions: true,
      messageForwarding: true,
      groupChat: true,
      directChat: true,
      typingIndicators: true,
      onlineStatus: true,
      messageSearch: true,
      conversationManagement: true
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Documentation endpoint
app.get('/api-docs', (req, res) => {
  res.json({
    service: 'Chat Service API',
    version: '1.0.0',
    endpoints: {
      conversations: {
        'POST /api/v1/conversations': 'Create new conversation',
        'GET /api/v1/conversations': 'Get user conversations',
        'GET /api/v1/conversations/:id': 'Get conversation details',
        'PUT /api/v1/conversations/:id': 'Update conversation',
        'DELETE /api/v1/conversations/:id': 'Delete conversation',
        'POST /api/v1/conversations/:id/participants': 'Add participants',
        'DELETE /api/v1/conversations/:id/participants/:userId': 'Remove participant',
        'PUT /api/v1/conversations/:id/archive': 'Archive/Unarchive conversation',
        'PUT /api/v1/conversations/:id/mute': 'Mute/Unmute conversation',
        'PUT /api/v1/conversations/:id/pin': 'Pin/Unpin conversation',
        'GET /api/v1/conversations/:id/typing': 'Get typing users'
      },
      messages: {
        'POST /api/v1/messages': 'Send message',
        'GET /api/v1/messages/:conversationId': 'Get messages',
        'PUT /api/v1/messages/:messageId': 'Edit message',
        'DELETE /api/v1/messages/:messageId': 'Delete message',
        'POST /api/v1/messages/:messageId/reaction': 'Add/Remove reaction',
        'PUT /api/v1/messages/:messageId/read': 'Mark as read',
        'POST /api/v1/messages/:messageId/forward': 'Forward message',
        'GET /api/v1/messages/:conversationId/search': 'Search messages',
        'GET /api/v1/messages/:conversationId/stats': 'Get message stats'
      },
      media: {
        'POST /api/v1/media/:conversationId/upload': 'Upload media files',
        'GET /api/v1/media/:conversationId': 'Get media files',
        'DELETE /api/v1/media/:conversationId/:fileKey': 'Delete media file',
        'GET /api/v1/media/info/formats': 'Get supported formats',
        'GET /api/v1/media/info/limits': 'Get upload limits'
      }
    },
    websocket: {
      url: `ws://localhost:${PORT}/ws`,
      events: {
        client_to_server: [
          'SEND_MESSAGE', 'JOIN_CONVERSATION', 'LEAVE_CONVERSATION',
          'TYPING_START', 'TYPING_STOP', 'MESSAGE_REACTION', 'MESSAGE_READ',
          'GET_ONLINE_USERS', 'PING'
        ],
        server_to_client: [
          'NEW_MESSAGE', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_REACTION_UPDATED',
          'MESSAGE_READ', 'USER_TYPING', 'USER_JOINED', 'USER_LEFT', 'USER_ONLINE',
          'USER_OFFLINE', 'CONVERSATION_CREATED', 'CONVERSATION_UPDATED', 'CONVERSATION_DELETED',
          'PARTICIPANTS_ADDED', 'PARTICIPANT_REMOVED', 'CONNECTION_SUCCESS', 'ERROR', 'PONG'
        ]
      }
    },
    authentication: {
      methods: ['Bearer Token', 'Cookie', 'Query Parameter'],
      required: true
    }
  });
});

// WebSocket endpoint info
app.get('/ws-info', (req, res) => {
  res.json({
    websocketUrl: `ws://localhost:${PORT}/ws`,
    secureWebsocketUrl: `wss://localhost:${PORT}/ws`,
    connectionCount: wss.clients.size,
    connectedUsers: wsManager ? wsManager.getConnectedUsersCount() : 0,
    supportedEvents: [
      'SEND_MESSAGE',
      'JOIN_CONVERSATION',
      'LEAVE_CONVERSATION',
      'TYPING_START',
      'TYPING_STOP',
      'MESSAGE_REACTION',
      'MESSAGE_READ',
      'GET_ONLINE_USERS',
      'PING'
    ],
    authMethods: [
      'Cookie (token=...)',
      'Authorization header (Bearer token)',
      'Query parameter (?token=...)'
    ]
  });
});

// 404 handler
app.use('*', (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

// Graceful shutdown function
async function gracefulShutdown(signal: string) {
  console.log(`🔄 ${signal} received, shutting down gracefully...`);
  
  try {
    // Close WebSocket connections
    wss.clients.forEach((ws) => {
      ws.close(1000, 'Server shutting down');
    });
    
    // Close WebSocket server
    wss.close(() => {
      console.log('🔌 WebSocket server closed');
    });
    
    // Disconnect from Redis
    await disconnectRedis();
    
    // Close HTTP server
    server.close(() => {
      console.log('🔴 Chat Service shut down successfully');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.log('⚠️ Forcing shutdown...');
      process.exit(1);
    }, 10000);
    
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Graceful shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
async function startServer() {
  try {
    await initializeServices();
    
    server.listen(PORT, () => {
      console.log(`🚀 Chat Service running on port ${PORT}`);
      console.log(`🔌 WebSocket server active at ws://localhost:${PORT}/ws`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`📚 API docs: http://localhost:${PORT}/api-docs`);
      console.log(`🧪 WebSocket test: http://localhost:${PORT}/ws-test`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('');
      console.log('🎯 Available Features:');
      console.log('   ✅ Real-time messaging');
      console.log('   ✅ File upload & media processing');
      console.log('   ✅ Message reactions & replies');
      console.log('   ✅ Message forwarding & editing');
      console.log('   ✅ Group & direct chats');
      console.log('   ✅ Typing indicators');
      console.log('   ✅ Online status tracking');
      console.log('   ✅ Message search & statistics');
      console.log('   ✅ Conversation management');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  gracefulShutdown('UNHANDLED_REJECTION');
});

startServer();