// api-gateway/src/types/index.type.ts
import { Request, Response } from "express";

export interface ServiceConfig {
  name: string;
  url: string;
  path: string;
  timeout?: number;
}

export interface ProxyOptions {
  target: string;
  changeOrigin: boolean;
  timeout?: number;
  proxyTimeout?: number;
  secure?: boolean;
  followRedirects?: boolean;
  pathRewrite?: Record<string, string> | ((path: string, req: Request) => string);
  onProxyReq?: (proxyReq: any, req: Request, res: Response) => void;
  onProxyRes?: (proxyRes: any, req: Request, res: Response) => void;
  onError?: (err: Error, req: Request, res: Response) => void;
}

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  uptime: number;
  environment: string;
  services: ServiceConfig[];
}

export interface ServiceStatus {
  name: string;
  status: string;
  url: string;
  responseTime?: string;
  httpStatus?: number;
  error?: string;
  suggestion?: string;
}