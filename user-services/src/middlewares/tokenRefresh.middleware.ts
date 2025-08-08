// src/middleware/tokenRefresh.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { JWTService } from '../utils/jwtService.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email: string;
      };
      newAccessToken?: string;
    }
  }
}

/**
 * Middleware to handle automatic token refresh
 * This middleware will:
 * 1. Check if access token is expired
 * 2. If expired, try to refresh using refresh token from httpOnly cookie
 * 3. Set new access token in response header
 * 4. Continue with the request
 */
export const tokenRefreshMiddleware = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const refreshToken = req.cookies.refreshToken;

    // Extract access token
    const accessToken = JWTService.extractTokenFromHeader(authHeader);

    if (!accessToken) {
      return next(new AppError('Access token is required', 401));
    }

    try {
      // Try to verify access token
      const decoded = JWTService.verifyAccessToken(accessToken);
      
      // If verification successful, set user and continue
      req.user = {
        id: decoded.id,
        username: decoded.username,
        email: decoded.email
      };
      
      return next();
      
    } catch (error:any) {
      // If access token is expired, try to refresh
      if (error.message === 'Access token has expired') {
        
        if (!refreshToken) {
          return next(new AppError('Refresh token is required', 401));
        }

        try {
          // Generate new access token
          const newAccessToken = JWTService.refreshAccessToken(refreshToken);
          
          // Verify the new access token to get user info
          const decoded = JWTService.verifyAccessToken(newAccessToken);
          
          // Set user info
          req.user = {
            id: decoded.id,
            username: decoded.username,
            email: decoded.email
          };
          
          // Set new access token in response header for client to update
          res.setHeader('X-New-Access-Token', newAccessToken);
          req.newAccessToken = newAccessToken;
          
          return next();
          
        } catch (refreshError: any) {
          // Clear the invalid refresh token cookie
          res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
          });
          
          return next(new AppError('Session expired. Please login again.', 401));
        }
        
      } else {
        // For other token errors, return error
        return next(error);
      }
    }
  }
);

/**
 * Middleware to protect routes (requires valid access token)
 */
export const protect = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const accessToken = JWTService.extractTokenFromHeader(authHeader);

    if (!accessToken) {
      return next(new AppError('Access token is required. Please login.', 401));
    }

    try {
      const decoded = JWTService.verifyAccessToken(accessToken);
      
      req.user = {
        id: decoded.id,
        username: decoded.username,
        email: decoded.email
      };
      
      next();
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Middleware to handle optional authentication
 * Sets user if valid token is provided, but doesn't fail if no token
 */
export const optionalAuth = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const accessToken = JWTService.extractTokenFromHeader(authHeader);

    if (!accessToken) {
      return next(); // Continue without setting user
    }

    try {
      const decoded = JWTService.verifyAccessToken(accessToken);
      
      req.user = {
        id: decoded.id,
        username: decoded.username,
        email: decoded.email
      };
    } catch (error) {
      // Ignore token errors for optional auth
      // Continue without setting user
    }
    
    next();
  }
);

/**
 * Middleware to set refresh token as httpOnly cookie
 */
export const setRefreshTokenCookie = (
  res: Response, 
  refreshToken: string
): void => {
  const expiresIn = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: expiresIn,
    path: '/'
  });
};

/**
 * Middleware to clear refresh token cookie
 */
export const clearRefreshTokenCookie = (res: Response): void => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });
};

/**
 * Response helper to send tokens
 */
export const sendTokenResponse = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
  user: any,
  statusCode: number = 200
): void => {
  // Set refresh token as httpOnly cookie
  setRefreshTokenCookie(res, tokens.refreshToken);
  
  // Send response with access token
  res.status(statusCode).json({
    status: 'success',
    data: {
      accessToken: tokens.accessToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        privacy: user.privacy,
        theme: user.theme,
        language: user.language
      }
    }
  });
};