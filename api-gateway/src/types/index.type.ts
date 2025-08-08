import { Options } from 'http-proxy-middleware';
import { Request } from 'express';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      ip: string;
    }
  }
}

export interface ServiceConfig {
  name: string;
  url: string;
  path: string;
  timeout?: number;
}

export interface ProxyOptions extends Options {
  pathRewrite?: { [key: string]: string };
}

export interface HealthCheckResponse {
  name: string;
  status: 'healthy' | 'unhealthy' | 'unreachable';
  url: string;
  responseTime?: string;
  httpStatus?: number;
  error?: string;
  suggestion?: string;
}

export interface ServiceStatusResponse {
  gateway: 'healthy' | 'degraded';
  timestamp: string;
  services: HealthCheckResponse[];
}

export interface ErrorResponse {
  error: string;
  message: string;
  service?: string;
  serviceUrl?: string;
  errorType?: string;
  timestamp: string;
  requestId?: string;
  suggestion?: string;
  path?: string;
  availableEndpoints?: string[];
}

export interface ApiDocumentationResponse {
  title: string;
  version: string;
  services: ServiceConfig[];
  endpoints: {
    [key: string]: {
      base: string;
      methods: string[];
      description: string;
    };
  };
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  environment: string;
  services: Array<{
    name: string;
    url: string;
    path: string;
  }>;
}

// Rate limiting types
export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message: {
    error: string;
    retryAfter: number;
  };
  standardHeaders: boolean;
  legacyHeaders: boolean;
  keyGenerator: (req: Request) => string;
}

// Environment variables type
export interface EnvironmentVariables {
  PORT?: string;
  NODE_ENV?: 'development' | 'production' | 'test';
  USER_SERVICE_URL?: string;
  CHAT_SERVICE_URL?: string;
  NOTIFICATION_SERVICE_URL?: string;
  CORS_ORIGIN?: string;
  LOG_LEVEL?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  HELMET_CSP_ENABLED?: string;
  TRUST_PROXY?: string;
  DOCKER_ENV?: string;
  KUBERNETES_SERVICE_HOST?: string;
}

export type ServiceName = 'user-service' | 'chat-service' | 'notification-service';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';

export {};