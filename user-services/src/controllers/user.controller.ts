// src/controllers/user.controller.ts
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import User from '../models/user.model.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { S3UploadService } from '../utils/s3Upload.js';


interface Uploadprofile {
    fullName: string;
    bio: string;
    theme: string;
    language: string;
    timezone: string;
}

// Get current user profile
export const getProfile = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  const user = await User.findById(userId);

  if (!user) {
    return next(new AppError('User not found', 404));
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
        timezone: user.timezone,
        notifications: user.notifications,
        accountCreatedAt: user.accountCreatedAt
      }
    }
  });
});

// Update user profile
export const updateProfile = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  const { fullName, bio, theme, language, timezone } = req.body;

  if(fullName.length > 50 || fullName.length < 2) {
    return next(new AppError('Full name must be between 2 and 50 characters', 400));
  }

  if(bio.length > 250) {
    return next(new AppError('Bio must be less than 250 characters', 400));
  }

  // Build update object with only provided fields
  const updateData: Uploadprofile = {
      fullName: '',
      bio: '',
      theme: '',
      language: '',
      timezone: ''
  };
  
  if (fullName !== undefined) updateData.fullName = fullName;
  if (bio !== undefined) updateData.bio = bio;
  if (theme !== undefined) updateData.theme = theme;
  if (language !== undefined) updateData.language = language;
  if (timezone !== undefined) updateData.timezone = timezone;

  const user = await User.findByIdAndUpdate(
    userId,
    updateData,
    { new: true, runValidators: true }
  );

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Profile updated successfully',
    data: {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        bio: user.bio,
        theme: user.theme,
        language: user.language,
        timezone: user.timezone
      }
    }
  });
});

// Upload/Update avatar
export const uploadAvatar = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  if (!req.file) {
    return next(new AppError('Please select an image to upload', 400));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  try {
    // Get old avatar key for deletion
    const oldAvatarKey = user.avatar ? S3UploadService.extractKeyFromUrl(user.avatar) : undefined;

    // Upload new avatar
    const uploadResult = await S3UploadService.uploadAvatar(userId as string, req.file, oldAvatarKey || undefined);

    // Update user with new avatar URL
    user.avatar = uploadResult.cloudFrontUrl;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      status: 'success',
      message: 'Avatar uploaded successfully',
      data: {
        avatar: uploadResult.cloudFrontUrl,
        size: uploadResult.size,
        format: uploadResult.format
      }
    });

  } catch (error) {
    return next(error);
  }
});

// Remove avatar
export const removeAvatar = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  if (!user.avatar) {
    return next(new AppError('No avatar to remove', 400));
  }

  try {
    // Extract key and delete from S3
    const avatarKey = S3UploadService.extractKeyFromUrl(user.avatar);
    if (avatarKey) {
      await S3UploadService.deleteFile(avatarKey);
    }

    // Update user
    user.avatar = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      status: 'success',
      message: 'Avatar removed successfully'
    });

  } catch (error) {
    return next(new AppError('Failed to remove avatar', 500));
  }
});

// Complete onboarding (bio + profile pic)
export const completeOnboarding = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  const { bio,language,timezone,theme } = req.body;

  if(bio.length > 250) {
    return next(new AppError('Bio must be less than 250 characters', 400));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Update bio
  if (bio !== undefined) {
    user.bio = bio;
  }

  // Update language
  if (language !== undefined) {
    user.language = language;
  }

  // Update timezone
  if (timezone !== undefined) {
    user.timezone = timezone;
  }

  // Update theme
  if (theme !== undefined) {
    user.theme = theme;
  }

  // Handle avatar upload if provided
  if (req.file) {
    try {
      const uploadResult = await S3UploadService.uploadAvatar(userId as string, req.file);
      user.avatar = uploadResult.cloudFrontUrl;
    } catch (error) {
      return next(new AppError('Failed to upload avatar during onboarding', 500));
    }
  }

  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'Onboarding completed successfully',
    data: {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        bio: user.bio,
        isEmailVerified: user.isEmailVerified
      }
    }
  });
});

// Get suggested users for onboarding
export const getSuggestedUsers = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  const { limit = 10 } = req.query;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Get users that current user is not following and not blocked
  const suggestedUsers = await User.find({
    _id: { 
      $ne: userId,
      $nin: [...user.following, ...user.blockedUsers, ...user.blockedBy]
    },
    isActive: true,
    isEmailVerified: true
  })
  .select('username fullName avatar bio followersCount isOnline')
  .sort({ followersCount: -1, createdAt: -1 })
  .limit(parseInt(limit as string));

  res.status(200).json({
    status: 'success',
    results: suggestedUsers.length,
    data: {
      users: suggestedUsers.map(suggestedUser => ({
        id: suggestedUser._id,
        username: suggestedUser.username,
        fullName: suggestedUser.fullName,
        avatar: suggestedUser.avatar,
        bio: suggestedUser.bio,
        followersCount: suggestedUser.followersCount,
        isOnline: suggestedUser.isOnline
      }))
    }
  });
});

// Update privacy settings
export const updatePrivacySettings = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  const { privacy } = req.body;

  if (!privacy) {
    return next(new AppError('Privacy settings are required', 400));
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { privacy },
    { new: true, runValidators: true }
  );

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Privacy settings updated successfully',
    data: {
      privacy: user.privacy
    }
  });
});

// Update notification settings
export const updateNotificationSettings = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  const { notifications } = req.body;

  if (!notifications) {
    return next(new AppError('Notification settings are required', 400));
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { notifications },
    { new: true, runValidators: true }
  );

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Notification settings updated successfully',
    data: {
      notifications: user.notifications
    }
  });
});

// Search users
export const searchUsers = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { q, limit = 20 } = req.query;
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  if (!q || typeof q !== 'string') {
    return next(new AppError('Search query is required', 400));
  }

  const searchQuery = q.trim();
  if (searchQuery.length < 2) {
    return next(new AppError('Search query must be at least 2 characters', 400));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Search users by username or full name
  const users = await User.find({
    _id: { 
      $ne: userId,
      $nin: user.blockedBy // Don't show users who blocked current user
    },
    isActive: true,
    $or: [
      { username: { $regex: searchQuery, $options: 'i' } },
      { fullName: { $regex: searchQuery, $options: 'i' } }
    ]
  })
  .select('username fullName avatar bio followersCount isOnline privacy')
  .limit(parseInt(limit as string));

  // Filter based on privacy settings
  const filteredUsers = users.filter(searchedUser => {
    // If user blocked current user
    if (user.blockedUsers.includes(searchedUser._id)) {
      return false;
    }
    
    return true;
  });

  res.status(200).json({
    status: 'success',
    results: filteredUsers.length,
    data: {
      users: filteredUsers.map(searchedUser => ({
        id: searchedUser._id,
        username: searchedUser.username,
        fullName: searchedUser.fullName,
        avatar: searchedUser.avatar,
        bio: searchedUser.bio,
        followersCount: searchedUser.followersCount,
        isOnline: searchedUser.isOnline,
        isPrivate: searchedUser.privacy.isPrivate
      }))
    }
  });
});

// Get user by username
export const getUserByUsername = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { username } = req.params;
  const currentUserId = req.user?.id;

  // Ensure username exists
  if (!username) {
    return next(new AppError('Username is required', 400));
  }

  // Ensure currentUserId exists
  if (!currentUserId) {
    return next(new AppError('Authentication required', 401));
  }

  const user = await User.findOne({
    username: username.toLowerCase(),
    isActive: true
  }).select('username fullName avatar bio followersCount followingCount isOnline lastSeen privacy accountCreatedAt blockedBy');

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const currentUser = await User.findById(currentUserId).select('following blockedUsers');
  if (!currentUser) {
    return next(new AppError('Current user not found', 404));
  }

  // Convert string ID to ObjectId for comparisons
  const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);
  
  // Check if current user is blocked - with proper null checks
  const isBlockedByUser = user.blockedBy?.includes(currentUserObjectId) || false;
  const hasBlockedUser = currentUser.blockedUsers?.includes(user._id) || false;
  
  if (isBlockedByUser || hasBlockedUser) {
    return next(new AppError('User not found', 404));
  }

  // Check privacy settings - with proper null checks
  const isFollowing = currentUser.following?.includes(user._id) || false;
  const canViewProfile = !user.privacy?.isPrivate || isFollowing || currentUserId === user._id.toString();

  if (!canViewProfile) {
    res.status(200).json({
      status: 'success',
      data: {
        user: {
          id: user._id,
          username: user.username,
          fullName: user.fullName,
          avatar: user.avatar,
          isPrivate: true,
          followersCount: user.followersCount || 0,
          followingCount: user.followingCount || 0
        }
      }
    });
    return;
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        bio: user.bio,
        followersCount: user.followersCount || 0,
        followingCount: user.followingCount || 0,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        accountCreatedAt: user.accountCreatedAt,
        isPrivate: user.privacy?.isPrivate || false,
        isFollowing: isFollowing
      }
    }
  });
});