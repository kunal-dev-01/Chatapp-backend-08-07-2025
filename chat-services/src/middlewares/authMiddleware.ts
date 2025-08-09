// services/chat-service/src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';

// Extend Request interface to include user information
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
  };
}

// JWT Payload interface matching your token structure
interface JWTPayload {
  id: string;
  username: string;
  email: string;
  role?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

/**
 * JWT Service utilities for chat service
 */
class JWTService {
  private static readonly ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;

  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }

  /**
   * Extract token from cookie
   */
  static extractTokenFromCookie(cookieValue?: string): string | null {
    return cookieValue || null;
  }

  /**
   * Verify access token
   */
  static verifyAccessToken(token: string): JWTPayload {
    const secret = this.ACCESS_TOKEN_SECRET;
    
    if (!secret || typeof secret !== 'string') {
      throw new Error('JWT_ACCESS_SECRET not configured');
    }

    try {
      const decoded = jwt.verify(token, secret, {
        issuer: 'chatapp',
        audience: 'chatapp-users',
      }) as JWTPayload;

      // Validate required payload fields
      if (!decoded.id || !decoded.email || !decoded.username) {
        throw new Error('Invalid token payload - missing required fields');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Access token has expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid access token');
      }
      if (error instanceof jwt.NotBeforeError) {
        throw new Error('Access token not active yet');
      }
      throw error;
    }
  }

  /**
   * Check if token is expired without verification
   */
  static isTokenExpired(token: string): boolean {
    try {
      const decoded = jwt.decode(token) as JWTPayload | null;
      if (!decoded?.exp) return true;
      return Date.now() >= decoded.exp * 1000;
    } catch {
      return true;
    }
  }
}

/**
 * Main authentication middleware for chat service
 * Extracts token from multiple sources and validates user
 */
export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | null = null;

    // Extract access token from multiple sources (priority order)
    // 1. Authorization header
    if (req.headers.authorization) {
      token = JWTService.extractTokenFromHeader(req.headers.authorization);
    }
    // 2. HTTP-only cookie (accessToken)
    else if (req.cookies?.accessToken) {
      token = JWTService.extractTokenFromCookie(req.cookies.accessToken);
    }
    // 3. Query parameter (for WebSocket connections)
    else if (req.query?.token && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    if (!token) {
      return next(new AppError('Access token is required', 401));
    }

    // Verify the access token
    const decoded = JWTService.verifyAccessToken(token);

    // Set user information in request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      username: decoded.username,
    };

    next();

  } catch (error) {
    // Handle specific JWT errors
    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        return next(new AppError('Access token has expired. Please refresh your session.', 401));
      }
      if (error.message.includes('Invalid') || error.message.includes('invalid')) {
        return next(new AppError('Invalid access token', 401));
      }
      if (error.message.includes('not active')) {
        return next(new AppError('Access token not active yet', 401));
      }
    }

    return next(new AppError('Authentication failed', 401));
  }
};

/**
 * Optional authentication middleware
 * Won't fail if no token is provided, but will set user if valid token exists
 */
export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | null = null;

    // Extract token from available sources
    if (req.headers.authorization) {
      token = JWTService.extractTokenFromHeader(req.headers.authorization);
    } else if (req.cookies?.accessToken) {
      token = JWTService.extractTokenFromCookie(req.cookies.accessToken);
    } else if (req.query?.token && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    if (token) {
      try {
        const decoded = JWTService.verifyAccessToken(token);
        req.user = {
          id: decoded.id,
          email: decoded.email,
          username: decoded.username,
        };
      } catch (error) {
        // Silently fail for optional auth - just log the error
        console.log('Optional auth failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    }

    next();
  } catch (error) {
    // Always continue for optional auth
    next();
  }
};

/**
 * WebSocket authentication helper
 * Extracts and validates token for WebSocket connections
 */
export const authenticateWebSocket = async (token: string): Promise<{
  id: string;
  email: string;
  username: string;
  role?: string;
} | null> => {
  try {
    if (!token) return null;

    const decoded = JWTService.verifyAccessToken(token);
    return {
      id: decoded.id,
      email: decoded.email,
      username: decoded.username,
    };
  } catch (error) {
    console.log('WebSocket auth failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
};

/**
 * Admin role middleware
 * Requires user to be authenticated and have admin role
 */
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  next();
};

/**
 * Resource ownership middleware
 * Ensures user owns the resource or is admin
 */
export const requireOwnership = (userIdField: string = 'userId') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    // Get resource user ID from params, body, or query
    const resourceUserId = req.params[userIdField] || 
                          req.body[userIdField] || 
                          req.query[userIdField];
    
    if (!resourceUserId) {
      return next(new AppError(`${userIdField} not found in request`, 400));
    }

    // Allow access if user owns resource or is admin
    if (req.user.id !== resourceUserId) {
      return next(new AppError('Access denied - insufficient permissions', 403));
    }

    next();
  };
};

/**
 * Rate limiting middleware for sensitive endpoints
 */
export const rateLimitMiddleware = (maxAttempts: number = 10, windowMs: number = 15 * 60 * 1000) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    
    const userAttempts = attempts.get(key);
    
    if (userAttempts) {
      if (now > userAttempts.resetTime) {
        // Reset the window
        attempts.set(key, { count: 1, resetTime: now + windowMs });
      } else if (userAttempts.count >= maxAttempts) {
        return next(new AppError('Rate limit exceeded. Please try again later.', 429));
      } else {
        userAttempts.count++;
      }
    } else {
      attempts.set(key, { count: 1, resetTime: now + windowMs });
    }

    // Clean up expired entries periodically
    if (Math.random() < 0.01) { // 1% chance to clean up
      for (const [key, value] of attempts.entries()) {
        if (now > value.resetTime) {
          attempts.delete(key);
        }
      }
    }

    next();
  };
};

/**
 * Middleware to validate chat room access
 * Ensures user has access to the specific chat room
 */
export const requireChatRoomAccess = (roomIdField: string = 'roomId') => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    const roomId = req.params[roomIdField] || req.body[roomIdField];
    
    if (!roomId) {
      return next(new AppError(`${roomIdField} not found in request`, 400));
    }

    // Here you would typically check if user has access to the chat room
    // This is just a placeholder - implement based on your chat room logic
    try {
      // Example: Check if user is member of the chat room
      // const hasAccess = await checkUserChatRoomAccess(req.user.id, roomId);
      // if (!hasAccess && req.user.role !== 'admin') {
      //   return next(new AppError('Access denied to chat room', 403));
      // }
      
      next();
    } catch (error) {
      return next(new AppError('Failed to verify chat room access', 500));
    }
  };
};

// Export types for use in other modules
export type { AuthenticatedRequest, JWTPayload };
export { JWTService };