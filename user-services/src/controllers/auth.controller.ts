// src/controllers/auth.controller.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import User from '../models/user.model';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../utils/AppError.js';
import { JWTService } from '../utils/jwtService.js';
import { sendTokenResponse, clearRefreshTokenCookie } from '../middlewares/tokenRefresh.middleware.js';
import { sendEmail } from '../utils/email.js';

// Register new user
export const register = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { username, email, password, fullName } = req.body;

  if (!username || !email || !password || !fullName) {
    return next(new AppError('All fields are required', 400));
  }

  const validPassword = password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/);

  if (!validPassword) {
    return next(new AppError('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character', 400));
  }
  if (password.length < 6) {
    return next(new AppError('Password must be at least 6 characters', 400));
  }

  const validUsername = username.match(/^[a-zA-Z0-9_]+$/);

  if (!validUsername) {
    return next(new AppError('Username can only contain letters, numbers, and underscores', 400));
  }

  if (username.length < 3) {
    return next(new AppError('Username must be at least 3 characters', 400));
  }

  if (username.length > 30) {
    return next(new AppError('Username cannot exceed 30 characters', 400));
  }

  const validEmail = email.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);

  if (!validEmail) {
    return next(new AppError('Please provide a valid email', 400));
  }

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ email }, { username }]
  });

  if (existingUser) {
    if (existingUser.email === email) {
      return next(new AppError('Email already registered', 400));
    }
    if (existingUser.username === username) {
      return next(new AppError('Username already taken', 400));
    }
  }

  // Create user
  const user = await User.create({
    username: username.toLowerCase(),
    email: email.toLowerCase(),
    password,
    fullName
  });

  // Generate email verification token
  const verificationToken = user.createEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // Send verification email
  try {
    const verificationUrl = `${process.env.CLIENT_URL}/verify-email/${verificationToken}`;
    
    await sendEmail({
      to: user.email,
      subject: 'Verify Your Email - ChatApp',
      templateName: 'emailVerification',
      templateData: {
        fullName: user.fullName,
        verificationUrl,
        appName: 'ChatApp'
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'User registered successfully. Please check your email to verify your account.',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          isEmailVerified: user.isEmailVerified
        }
      }
    });

  } catch (emailError) {
    // If email fails, remove verification token but keep user
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new AppError('User created but failed to send verification email. Please request a new verification email.', 500));
  }
});

// Login user
export const login = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { identifier, password } = req.body; // identifier can be email or username

  if (!identifier || !password) {
    return next(new AppError('Please provide email/username and password', 400));
  }

  // Find user by email or username
  const user = await User.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { username: identifier.toLowerCase() }
    ]
  }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid credentials', 401));
  }

  // Check if account is active
  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 401));
  }

  // Update user status
  user.isOnline = true;
  user.lastSeen = new Date();
  await user.save({ validateBeforeSave: false });

  // Generate tokens
  const tokens = JWTService.generateTokenPair({
    id: user._id.toString(),
    username: user.username,
    email: user.email
  });

  // Send response with tokens
  sendTokenResponse(res, tokens, user);
});

// Logout user
export const logout = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const userId = req.user?.id;

  if (userId) {
    // Update user status
    await User.findByIdAndUpdate(userId, {
      isOnline: false,
      lastSeen: new Date()
    });
  }

  // Clear refresh token cookie
  clearRefreshTokenCookie(res);

  res.status(200).json({
    status: 'success',
    message: 'Logged out successfully'
  });
});

// Verify email
export const verifyEmail = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { token } = req.params;

  if (!token) {
    return next(new AppError('Verification token is required', 400));
  }

  // Hash the token
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with this token
  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() }
  });

  if (!user) {
    return next(new AppError('Invalid or expired verification token', 400));
  }

  // Update user
  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'Email verified successfully! You can now use all features.',
    data: {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        isEmailVerified: user.isEmailVerified
      }
    }
  });
});

// Resend verification email
export const resendVerificationEmail = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { email } = req.body;

  if (!email) {
    return next(new AppError('Email is required', 400));
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return next(new AppError('No user found with this email', 404));
  }

  if (user.isEmailVerified) {
    return next(new AppError('Email is already verified', 400));
  }

  // Generate new verification token
  const verificationToken = user.createEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // Send verification email
  try {
    const verificationUrl = `${process.env.CLIENT_URL}/verify-email/${verificationToken}`;
    
    await sendEmail({
      to: user.email,
      subject: 'Verify Your Email - ChatApp',
      templateName: 'emailVerification',
      templateData: {
        fullName: user.fullName,
        verificationUrl,
        appName: 'ChatApp'
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'Verification email sent successfully'
    });

  } catch (emailError) {
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new AppError('Failed to send verification email. Please try again later.', 500));
  }
});

// Forgot password
export const forgotPassword = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { email } = req.body;

  if (!email) {
    return next(new AppError('Email is required', 400));
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return next(new AppError('No user found with this email', 404));
  }

  // Generate reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // Send reset email
  try {
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    
    await sendEmail({
      to: user.email,
      subject: 'Password Reset Request - ChatApp',
      templateName: 'passwordReset',
      templateData: {
        fullName: user.fullName,
        resetUrl,
        appName: 'ChatApp',
        validFor: '10 minutes'
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'Password reset email sent successfully'
    });

  } catch (emailError) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new AppError('Failed to send password reset email. Please try again later.', 500));
  }
});

// Reset password
export const resetPassword = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (!token) {
    return next(new AppError('Reset token is required', 400));
  }

  if (!password || !confirmPassword) {
    return next(new AppError('Password and confirm password are required', 400));
  }

  if (password !== confirmPassword) {
    return next(new AppError('Passwords do not match', 400));
  }

  // Hash the token
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with this token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }
  });

  if (!user) {
    return next(new AppError('Invalid or expired reset token', 400));
  }

  // Update password
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.passwordChangedAt = new Date();
  await user.save();

  // Generate new tokens
  const tokens = JWTService.generateTokenPair({
    id: user._id.toString(),
    username: user.username,
    email: user.email
  });

  // Send response with tokens
  sendTokenResponse(res, tokens, user, 200);
});

// Check authentication status
export const checkAuth = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('Not authenticated', 401));
  }

  const user = await User.findById(userId);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  if (!user.isActive) {
    return next(new AppError('Account is deactivated', 401));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        bio: user.bio,
        isEmailVerified: user.isEmailVerified,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        privacy: user.privacy,
        theme: user.theme,
        language: user.language,
        notifications: user.notifications
      }
    }
  });
});

// Refresh token
export const refreshToken = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return next(new AppError('Refresh token is required', 401));
  }

  try {
    // Verify refresh token
    const decoded = JWTService.verifyRefreshToken(refreshToken);
    
    // Find user
    const user = await User.findById(decoded.id);
    
    if (!user || !user.isActive) {
      clearRefreshTokenCookie(res);
      return next(new AppError('User not found or inactive', 401));
    }

    // Generate new access token
    const newAccessToken = JWTService.generateAccessToken({
      id: user._id.toString(),
      username: user.username,
      email: user.email
    });

    res.status(200).json({
      status: 'success',
      data: {
        accessToken: newAccessToken
      }
    });

  } catch (error) {
    clearRefreshTokenCookie(res);
    return next(new AppError('Invalid refresh token', 401));
  }
});