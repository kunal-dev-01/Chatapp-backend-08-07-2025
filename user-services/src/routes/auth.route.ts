// src/routes/auth.routes.ts
import { Router } from 'express';
import {
  register,
  login,
  logout,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
  checkAuth,
  refreshToken
} from '../controllers/auth.controller.js';
import { tokenRefreshMiddleware } from '../middlewares/tokenRefresh.middleware.js';

const router = Router();

// Auth routes
router.post('/register', register);
router.post('/login',  login);
router.post('/logout', tokenRefreshMiddleware, logout);
router.post('/refresh-token', refreshToken);

// Email verification
router.get('/verify-email/:token', verifyEmail);
router.post('/resend-verification', resendVerificationEmail);

// Password reset
router.post('/forgot-password', forgotPassword);
router.patch('/reset-password/:token', resetPassword);

// Check auth status
router.get('/check-auth', tokenRefreshMiddleware, checkAuth);

export default router;