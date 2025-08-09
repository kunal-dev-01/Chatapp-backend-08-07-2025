// services/chat-service/src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';

// Extend Request interface
interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string | undefined;
  };
  newAccessToken?: string;
}

interface JWTPayload {
  userId?: string;
  id?: string;
  email: string;
  role?: string;
  iat?: number;
  exp?: number;
}

/**
 * JWT Service utilities
 */
class JWTService {
  private static readonly ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;
  private static readonly REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET;

  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }

  static verifyAccessToken(token: string): JWTPayload {
    const secret = this.ACCESS_TOKEN_SECRET;
    if (!secret || typeof secret !== 'string') {
      throw new Error('JWT secret not configured');
    }
    try {
      return jwt.verify(token, secret) as JWTPayload;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error(`Invalid access token: ${error.message}`);
      }
      throw error;
    }
  }

  static verifyRefreshToken(token: string): JWTPayload {
    const secret = this.REFRESH_TOKEN_SECRET;
    if (!secret || secret === 'undefined' || typeof secret !== 'string') {
      throw new Error('JWT refresh secret not configured');
    }
    try {
      return jwt.verify(token, secret) as JWTPayload;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error(`Invalid refresh token: ${error.message}`);
      }
      throw error;
    }
  }

}

/**
 * Enhanced Auth Middleware with automatic token refresh
 */
export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | null = null;
    const refreshToken = req.cookies?.refreshToken;

    // Extract access token from multiple sources
    if (req.headers.authorization) {
      token = JWTService.extractTokenFromHeader(req.headers.authorization);
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.query?.token) {
      token = req.query.token as string;
    }

    if (!token) {
      return next(new AppError('Access token is required', 401));
    }

    try {
      // Try to verify access token
      const decoded = JWTService.verifyAccessToken(token);
      const userId = decoded.userId || decoded.id;

      if (!userId) {
        return next(new AppError('Invalid token payload', 401));
      }

      // Set user info and continue
      req.user = {
        userId,
        email: decoded.email,
        role: decoded.role
      };

      return next();

    } catch (error) {
      // If access token is expired and we have refresh token, try to refresh
      if (error instanceof jwt.TokenExpiredError && refreshToken) {
        try {

          return next();

        } catch (refreshError) {
          // Clear invalid refresh token cookie
          res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
          });

          return next(new AppError('Session expired. Please login again.', 401));
        }
      }

      // Handle other JWT errors
      if (error instanceof jwt.JsonWebTokenError) {
        return next(new AppError('Invalid token', 401));
      }
      if (error instanceof jwt.NotBeforeError) {
        return next(new AppError('Token not active', 401));
      }

      return next(new AppError('Authentication failed', 401));
    }
  } catch (error) {
    return next(new AppError('Authentication failed', 401));
  }
};

/**
 * Simple auth middleware without refresh logic (for performance-critical routes)
 */
export const simpleAuthMiddleware = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | null = null;

    // Extract token
    if (req.headers.authorization) {
      token = JWTService.extractTokenFromHeader(req.headers.authorization);
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.query?.token) {
      token = req.query.token as string;
    }

    if (!token) {
      return next(new AppError('Access token is required', 401));
    }

    const decoded = JWTService.verifyAccessToken(token);
    const userId = decoded.userId || decoded.id;

    if (!userId) {
      return next(new AppError('Invalid token payload', 401));
    }

    req.user = {
      userId,
      email: decoded.email,
      role: decoded.role
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError('Invalid token', 401));
    }
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError('Token expired', 401));
    }
    if (error instanceof jwt.NotBeforeError) {
      return next(new AppError('Token not active', 401));
    }
    
    return next(new AppError('Authentication failed', 401));
  }
};

/**
 * Optional auth middleware - doesn't fail if no token
 */
export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | null = null;

    if (req.headers.authorization) {
      token = JWTService.extractTokenFromHeader(req.headers.authorization);
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.query?.token) {
      token = req.query.token as string;
    }

    if (token) {
      try {
        const decoded = JWTService.verifyAccessToken(token);
        const userId = decoded.userId || decoded.id;
        
        if (userId) {
          req.user = {
            userId,
            email: decoded.email,
            role: decoded.role
          };
        }
      } catch (error) {
        // Silently fail for optional auth
        console.log('Optional auth failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    }

    next();
  } catch (error) {
    next();
  }
};

/**
 * Admin role middleware
 */
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  if (req.user.role !== 'admin') {
    return next(new AppError('Admin access required', 403));
  }

  next();
};

/**
 * Middleware to check if user owns resource
 */
export const requireOwnership = (userIdField: string = 'userId') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    const resourceUserId = req.params[userIdField] || req.body[userIdField];
    
    if (!resourceUserId) {
      return next(new AppError(`${userIdField} not found in request`, 400));
    }

    if (req.user.userId !== resourceUserId && req.user.role !== 'admin') {
      return next(new AppError('Access denied - not resource owner', 403));
    }

    next();
  };
};

/**
 * Rate limiting middleware for authentication endpoints
 */
export const authRateLimit = (maxAttempts: number = 5, windowMs: number = 15 * 60 * 1000) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    
    const userAttempts = attempts.get(key);
    
    if (userAttempts) {
      if (now > userAttempts.resetTime) {
        // Reset window
        attempts.set(key, { count: 1, resetTime: now + windowMs });
      } else if (userAttempts.count >= maxAttempts) {
        return next(new AppError('Too many authentication attempts. Please try again later.', 429));
      } else {
        userAttempts.count++;
      }
    } else {
      attempts.set(key, { count: 1, resetTime: now + windowMs });
    }

    next();
  };
};

/**
 * Middleware to extract user from WebSocket upgrade request
 */
export const extractWebSocketUser = (token: string): Promise<{ userId: string; email: string } | null> => {
  return new Promise((resolve) => {
    try {
      const decoded = JWTService.verifyAccessToken(token);
      const userId = decoded.userId || decoded.id;
      
      if (userId) {
        resolve({
          userId,
          email: decoded.email
        });
      } else {
        resolve(null);
      }
    } catch (error) {
      resolve(null);
    }
  });
};


export { JWTService };