import jwt, { JwtPayload } from 'jsonwebtoken';
import { AppError } from './AppError.js';
import {
    DecodedToken,
    TokenPayload,
    TokenPair,
} from '../types/jwt.type.js';

export class JWTService {
  private static readonly ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET!;
  private static readonly REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET!;
  private static readonly ACCESS_TOKEN_EXPIRE = '15m';
  private static readonly REFRESH_TOKEN_EXPIRE = '7d';

  public static generateAccessToken(payload: TokenPayload): string {
    try {
      return jwt.sign(payload, this.ACCESS_TOKEN_SECRET, {
        expiresIn: this.ACCESS_TOKEN_EXPIRE,
        issuer: 'chatapp',
        audience: 'chatapp-users',
      });
    } catch {
      throw new AppError('Failed to generate access token', 500);
    }
  }

  public static generateRefreshToken(payload: TokenPayload): string {
    try {
      return jwt.sign(payload, this.REFRESH_TOKEN_SECRET, {
        expiresIn: this.REFRESH_TOKEN_EXPIRE,
        issuer: 'chatapp',
        audience: 'chatapp-users',
      });
    } catch {
      throw new AppError('Failed to generate refresh token', 500);
    }
  }

  public static generateTokenPair(payload: TokenPayload): TokenPair {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken(payload),
    };
  }

  public static verifyAccessToken(token: string): DecodedToken {
    try {
      const decoded = jwt.verify(token, this.ACCESS_TOKEN_SECRET, {
        issuer: 'chatapp',
        audience: 'chatapp-users',
      });
      return decoded as DecodedToken;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('Access token has expired', 401);
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid access token', 401);
      }
      if (error instanceof jwt.NotBeforeError) {
        throw new AppError('Access token not active yet', 401);
      }
      throw new AppError('Access token verification failed', 401);
    }
  }

  public static verifyRefreshToken(token: string): DecodedToken {
    try {
      const decoded = jwt.verify(token, this.REFRESH_TOKEN_SECRET, {
        issuer: 'chatapp',
        audience: 'chatapp-users',
      });
      return decoded as DecodedToken;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('Refresh token has expired', 401);
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid refresh token', 401);
      }
      if (error instanceof jwt.NotBeforeError) {
        throw new AppError('Refresh token not active yet', 401);
      }
      throw new AppError('Refresh token verification failed', 401);
    }
  }

  public static refreshAccessToken(refreshToken: string): string {
    try {
      const decoded = this.verifyRefreshToken(refreshToken);
      return this.generateAccessToken({
        id: decoded.id,
        username: decoded.username,
        email: decoded.email,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to refresh access token', 401);
    }
  }

  public static extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
    return parts[1] || null;
  }

  public static getTokenExpiration(token: string): number | null {
    try {
      const decoded = jwt.decode(token) as JwtPayload | null;
      return decoded?.exp ?? null;
    } catch {
      return null;
    }
  }

  public static isTokenExpired(token: string): boolean {
    try {
      const decoded = jwt.decode(token) as JwtPayload | null;
      if (!decoded?.exp) return true;
      return Date.now() >= decoded.exp * 1000;
    } catch {
      return true;
    }
  }

  public static getTimeToExpiry(token: string): number {
    try {
      const decoded = jwt.decode(token) as JwtPayload | null;
      if (!decoded?.exp) return 0;
      const expiryTime = decoded.exp * 1000;
      return Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
    } catch {
      return 0;
    }
  }

  public static validateJWTConfig(): void {
    if (!this.ACCESS_TOKEN_SECRET) throw new Error('JWT_ACCESS_SECRET environment variable is required');
    if (!this.REFRESH_TOKEN_SECRET) throw new Error('JWT_REFRESH_SECRET environment variable is required');
    if (this.ACCESS_TOKEN_SECRET === this.REFRESH_TOKEN_SECRET)
      throw new Error('ACCESS and REFRESH secrets must differ');
    if (this.ACCESS_TOKEN_SECRET.length < 32)
      throw new Error('ACCESS_TOKEN_SECRET must be at least 32 characters');
    if (this.REFRESH_TOKEN_SECRET.length < 32)
      throw new Error('REFRESH_TOKEN_SECRET must be at least 32 characters');
  }

  public static getTokenConfig() {
    return {
      accessTokenExpire: this.ACCESS_TOKEN_EXPIRE,
      refreshTokenExpire: this.REFRESH_TOKEN_EXPIRE,
      issuer: 'chatapp',
      audience: 'chatapp-users',
    };
  }
}