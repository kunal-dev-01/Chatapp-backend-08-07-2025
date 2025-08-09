// src/controllers/follow.controller.ts
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import User from '../models/user.model.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';

/**
 * Follow a user
 * If user is private, send follow request
 * If user is public, follow directly
 */
export const followUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check validation errors
    const { userId } = req.params;
    const currentUserId = req.user?.id;

    // Ensure userId exists
    if (!userId) {
      next(new AppError('User ID is required', 400));
      return;
    }

    // Ensure user is authenticated
    if (!currentUserId) {
      next(new AppError('Authentication required', 401));
      return;
    }

    // Ensure userId exists
    if (!userId) {
      next(new AppError('User ID is required', 400));
      return;
    }

    // Check if trying to follow self
    if (userId === currentUserId) {
      next(new AppError('You cannot follow yourself', 400));
      return;
    }

    // Find the user to follow
    const userToFollow = await User.findById(userId);
    if (!userToFollow) {
      next(new AppError('User not found', 404));
      return;
    }

    // Find current user
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      next(new AppError('Current user not found', 404));
      return;
    }

    // Convert IDs to ObjectId for comparisons
    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);
    const userToFollowObjectId = new mongoose.Types.ObjectId(userId);

    // Enhanced block checking - check both directions
    const isCurrentUserBlocked = userToFollow.blockedUsers?.includes(currentUserObjectId);
    const isTargetUserBlocked = currentUser.blockedUsers?.includes(userToFollowObjectId);
    const isCurrentUserBlockedBy = currentUser.blockedBy?.includes(userToFollowObjectId);
    const isTargetUserBlockedBy = userToFollow.blockedBy?.includes(currentUserObjectId);

    if (isCurrentUserBlocked || isTargetUserBlocked || isCurrentUserBlockedBy || isTargetUserBlockedBy) {
      next(new AppError('Unable to follow this user', 403));
      return;
    }

    // Check if already following
    if (currentUser.following?.includes(userToFollowObjectId)) {
      next(new AppError('You are already following this user', 400));
      return;
    }

    // Check if follow request already sent
    if (currentUser.followRequests?.sent?.includes(userToFollowObjectId)) {
      next(new AppError('Follow request already sent', 400));
      return;
    }

    if (userToFollow.privacy?.isPrivate) {
      // Private account - send follow request
      if (!currentUser.followRequests) {
        currentUser.followRequests = { sent: [], received: [] };
      }
      if (!userToFollow.followRequests) {
        userToFollow.followRequests = { sent: [], received: [] };
      }

      currentUser.followRequests.sent.push(userToFollowObjectId);
      userToFollow.followRequests.received.push(currentUserObjectId);

      await Promise.all([currentUser.save(), userToFollow.save()]);

      res.status(200).json({
        status: 'success',
        message: 'Follow request sent successfully',
        data: {
          type: 'request_sent',
          user: {
            id: userToFollow._id,
            username: userToFollow.username,
            fullName: userToFollow.fullName,
            avatar: userToFollow.avatar,
            isPrivate: userToFollow.privacy?.isPrivate || false
          }
        }
      });
    } else {
      // Public account - follow directly
      if (!currentUser.following) {
        currentUser.following = [];
      }
      if (!userToFollow.followers) {
        userToFollow.followers = [];
      }

      currentUser.following.push(userToFollowObjectId);
      currentUser.followingCount = (currentUser.followingCount || 0) + 1;
      userToFollow.followers.push(currentUserObjectId);
      userToFollow.followersCount = (userToFollow.followersCount || 0) + 1;

      await Promise.all([currentUser.save(), userToFollow.save()]);

      res.status(200).json({
        status: 'success',
        message: 'User followed successfully',
        data: {
          type: 'followed',
          user: {
            id: userToFollow._id,
            username: userToFollow.username,
            fullName: userToFollow.fullName,
            avatar: userToFollow.avatar,
            followersCount: userToFollow.followersCount,
            isPrivate: userToFollow.privacy?.isPrivate || false
          }
        }
      });
    }
  }
);

/**
 * Unfollow a user
 */
export const unfollowUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check validation errors

    const { userId } = req.params;
    const currentUserId = req.user?.id;

    // Ensure userId exists
    if (!userId) {
      return next(new AppError('User ID is required', 400));
    }

    // Check if trying to unfollow self
    if (userId === currentUserId) {
      return next(new AppError('You cannot unfollow yourself', 400));
    }

    // Find both users
    const [currentUser, userToUnfollow] = await Promise.all([
      User.findById(currentUserId),
      User.findById(userId)
    ]);

    if (!currentUser) {
      return next(new AppError('Current user not found', 404));
    }

    if (!userToUnfollow) {
      return next(new AppError('User not found', 404));
    }

    // Check if actually following
    if (!currentUser.following.includes(new mongoose.Types.ObjectId(userId))) {
      return next(new AppError('You are not following this user', 400));
    }

    // Remove from following/followers
    currentUser.following = currentUser.following.filter(
      id => !id.equals(new mongoose.Types.ObjectId(userId))
    );
    currentUser.followingCount = Math.max(0, currentUser.followingCount - 1);

    userToUnfollow.followers = userToUnfollow.followers.filter(
      id => !id.equals(new mongoose.Types.ObjectId(currentUserId))
    );
    userToUnfollow.followersCount = Math.max(0, userToUnfollow.followersCount - 1);

    await Promise.all([currentUser.save(), userToUnfollow.save()]);

    res.status(200).json({
      status: 'success',
      message: 'User unfollowed successfully',
      data: {
        user: {
          id: userToUnfollow._id,
          username: userToUnfollow.username,
          fullName: userToUnfollow.fullName,
          avatar: userToUnfollow.avatar,
          followersCount: userToUnfollow.followersCount
        }
      }
    });
  }
);

/**
 * Accept follow request
 */
export const acceptFollowRequest = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check validation errors

    const { requesterId } = req.params;
    const currentUserId = req.user?.id;

    // Ensure requesterId exists
    if (!requesterId) {
      return next(new AppError('Requester ID is required', 400));
    }

    // Find both users
    const [currentUser, requester] = await Promise.all([
      User.findById(currentUserId),
      User.findById(requesterId)
    ]);

    if (!currentUser) {
      return next(new AppError('Current user not found', 404));
    }

    if (!requester) {
      return next(new AppError('Requester not found', 404));
    }

    // Check if request exists
    if (!currentUser.followRequests.received.includes(new mongoose.Types.ObjectId(requesterId))) {
      return next(new AppError('Follow request not found', 404));
    }

    // Remove from follow requests
    currentUser.followRequests.received = currentUser.followRequests.received.filter(
      id => !id.equals(new mongoose.Types.ObjectId(requesterId))
    );

    requester.followRequests.sent = requester.followRequests.sent.filter(
      id => !id.equals(new mongoose.Types.ObjectId(currentUserId))
    );

    // Add to followers/following
    currentUser.followers.push(new mongoose.Types.ObjectId(requesterId));
    currentUser.followersCount += 1;

    requester.following.push(new mongoose.Types.ObjectId(currentUserId));
    requester.followingCount += 1;

    await Promise.all([currentUser.save(), requester.save()]);

    res.status(200).json({
      status: 'success',
      message: 'Follow request accepted',
      data: {
        user: {
          id: requester._id,
          username: requester.username,
          fullName: requester.fullName,
          avatar: requester.avatar
        },
        followersCount: currentUser.followersCount
      }
    });
  }
);

/**
 * Reject follow request
 */
export const rejectFollowRequest = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check validation errors

    const { requesterId } = req.params;
    const currentUserId = req.user?.id;

    // Ensure requesterId exists
    if (!requesterId) {
      return next(new AppError('Requester ID is required', 400));
    }
    // Find both users
    const [currentUser, requester] = await Promise.all([
      User.findById(currentUserId),
      User.findById(requesterId)
    ]);

    if (!currentUser) {
      return next(new AppError('Current user not found', 404));
    }

    if (!requester) {
      return next(new AppError('Requester not found', 404));
    }

    // Check if request exists
    if (!currentUser.followRequests.received.includes(new mongoose.Types.ObjectId(requesterId))) {
      return next(new AppError('Follow request not found', 404));
    }

    // Remove from follow requests
    currentUser.followRequests.received = currentUser.followRequests.received.filter(
      id => !id.equals(new mongoose.Types.ObjectId(requesterId))
    );

    requester.followRequests.sent = requester.followRequests.sent.filter(
      id => !id.equals(new mongoose.Types.ObjectId(currentUserId))
    );

    await Promise.all([currentUser.save(), requester.save()]);

    res.status(200).json({
      status: 'success',
      message: 'Follow request rejected',
      data: {
        user: {
          id: requester._id,
          username: requester.username,
          fullName: requester.fullName,
          avatar: requester.avatar
        }
      }
    });
  }
);

/**
 * Cancel follow request
 */
export const cancelFollowRequest = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {

    const { userId } = req.params;
    const currentUserId = req.user?.id;

    // Ensure userId exists
    if (!userId) {
      return next(new AppError('User ID is required', 400));
    }

    // Find both users
    const [currentUser, targetUser] = await Promise.all([
      User.findById(currentUserId),
      User.findById(userId)
    ]);

    if (!currentUser) {
      return next(new AppError('Current user not found', 404));
    }

    if (!targetUser) {
      return next(new AppError('User not found', 404));
    }

    // Check if request exists
    if (!currentUser.followRequests.sent.includes(new mongoose.Types.ObjectId(userId))) {
      return next(new AppError('Follow request not found', 404));
    }

    // Remove from follow requests
    currentUser.followRequests.sent = currentUser.followRequests.sent.filter(
      id => !id.equals(new mongoose.Types.ObjectId(userId))
    );

    targetUser.followRequests.received = targetUser.followRequests.received.filter(
      id => !id.equals(new mongoose.Types.ObjectId(currentUserId))
    );

    await Promise.all([currentUser.save(), targetUser.save()]);

    res.status(200).json({
      status: 'success',
      message: 'Follow request cancelled',
      data: {
        user: {
          id: targetUser._id,
          username: targetUser.username,
          fullName: targetUser.fullName,
          avatar: targetUser.avatar
        }
      }
    });
  }
);

/**
 * Get followers list
 */
export const getFollowers = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { userId } = req.params;
    const currentUserId = req.user?.id;
    const targetUserId = userId || currentUserId;

    // Ensure userId exists
    if (!targetUserId) {
      return next(new AppError('User ID is required', 400));
    }

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Find target user
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return next(new AppError('User not found', 404));
    }

    // Privacy check
    if (targetUserId !== currentUserId && targetUser.privacy.isPrivate) {
      const currentUser = await User.findById(currentUserId);
      if (!currentUser?.following.includes(new mongoose.Types.ObjectId(targetUserId))) {
        return next(new AppError('This account is private', 403));
      }
    }

    // Get current user's blocked users list for filtering
    const currentUser = await User.findById(currentUserId).select('blockedUsers blockedBy');
    const blockedUserIds = currentUser?.blockedUsers || [];
    const blockedByIds = currentUser?.blockedBy || [];

    // Get followers with pagination, excluding blocked users
    const followers = await User.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(targetUserId) } },
      { $unwind: '$followers' },
      // Filter out blocked users if viewing own followers
      ...(targetUserId === currentUserId ? [
        {
          $match: {
            $and: [
              { 'followers': { $nin: blockedUserIds } },
              { 'followers': { $nin: blockedByIds } }
            ]
          }
        }
      ] : []),
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'followers',
          foreignField: '_id',
          as: 'followerData'
        }
      },
      { $unwind: '$followerData' },
      {
        $project: {
          'followerData._id': 1,
          'followerData.username': 1,
          'followerData.fullName': 1,
          'followerData.avatar': 1,
          'followerData.isOnline': 1,
          'followerData.followersCount': 1,
          'followerData.privacy.isPrivate': 1
        }
      }
    ]);

    // Calculate total followers excluding blocked users
    let totalFollowers = targetUser.followersCount;
    if (targetUserId === currentUserId) {
      const blockedCount = targetUser.followers.filter(followerId =>
        blockedUserIds.some(blockedId => blockedId.equals(followerId)) ||
        blockedByIds.some(blockedId => blockedId.equals(followerId))
      ).length;
      totalFollowers = Math.max(0, totalFollowers - blockedCount);
    }

    const totalPages = Math.ceil(totalFollowers / limit);

    res.status(200).json({
      status: 'success',
      data: {
        followers: followers.map(f => f.followerData),
        pagination: {
          page,
          limit,
          totalFollowers,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  }
);

/**
 * Get following list
 */
export const getFollowing = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { userId } = req.params;
    const currentUserId = req.user?.id;
    const targetUserId = userId || currentUserId;

    // Ensure userId exists
    if (!targetUserId) {
      return next(new AppError('User ID is required', 400));
    }

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Find target user
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return next(new AppError('User not found', 404));
    }

    // Privacy check
    if (targetUserId !== currentUserId && targetUser.privacy.isPrivate) {
      const currentUser = await User.findById(currentUserId);
      if (!currentUser?.following.includes(new mongoose.Types.ObjectId(targetUserId))) {
        return next(new AppError('This account is private', 403));
      }
    }

    // Get current user's blocked users list for filtering
    const currentUser = await User.findById(currentUserId).select('blockedUsers blockedBy');
    const blockedUserIds = currentUser?.blockedUsers || [];
    const blockedByIds = currentUser?.blockedBy || [];

    // Get following with pagination, excluding blocked users
    const following = await User.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(targetUserId) } },
      { $unwind: '$following' },
      // Filter out blocked users if viewing own following
      ...(targetUserId === currentUserId ? [
        {
          $match: {
            $and: [
              { 'following': { $nin: blockedUserIds } },
              { 'following': { $nin: blockedByIds } }
            ]
          }
        }
      ] : []),
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'following',
          foreignField: '_id',
          as: 'followingData'
        }
      },
      { $unwind: '$followingData' },
      {
        $project: {
          'followingData._id': 1,
          'followingData.username': 1,
          'followingData.fullName': 1,
          'followingData.avatar': 1,
          'followingData.isOnline': 1,
          'followingData.followersCount': 1,
          'followingData.privacy.isPrivate': 1
        }
      }
    ]);

    // Calculate total following excluding blocked users
    let totalFollowing = targetUser.followingCount;
    if (targetUserId === currentUserId) {
      const blockedCount = targetUser.following.filter(followingId =>
        blockedUserIds.some(blockedId => blockedId.equals(followingId)) ||
        blockedByIds.some(blockedId => blockedId.equals(followingId))
      ).length;
      totalFollowing = Math.max(0, totalFollowing - blockedCount);
    }

    const totalPages = Math.ceil(totalFollowing / limit);

    res.status(200).json({
      status: 'success',
      data: {
        following: following.map(f => f.followingData),
        pagination: {
          page,
          limit,
          totalFollowing,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  }
);

/**
 * Get follow requests (received)
 */
export const getFollowRequests = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return next(new AppError('User ID is required', 400));
    }
    
    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const user = await User.findById(currentUserId)
      .populate({
        path: 'followRequests.received',
        select: 'username fullName avatar isOnline followersCount',
        options: {
          skip: skip,
          limit: limit
        }
      });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const totalRequests = user.followRequests.received.length;
    const totalPages = Math.ceil(totalRequests / limit);

    res.status(200).json({
      status: 'success',
      data: {
        requests: user.followRequests.received,
        pagination: {
          page,
          limit,
          totalRequests,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  }
);

/**
 * Get sent follow requests
 */
export const getSentRequests = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return next(new AppError('User ID is required', 400));
    }
    
    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const user = await User.findById(currentUserId)
      .populate({
        path: 'followRequests.sent',
        select: 'username fullName avatar isOnline followersCount',
        options: {
          skip: skip,
          limit: limit
        }
      });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const totalRequests = user.followRequests.sent.length;
    const totalPages = Math.ceil(totalRequests / limit);

    res.status(200).json({
      status: 'success',
      data: {
        requests: user.followRequests.sent,
        pagination: {
          page,
          limit,
          totalRequests,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  }
);


export const blockUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check validation errors
    const { userId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      next(new AppError('User ID is required', 400));
      return;
    }

    // Ensure userId exists
    if (!userId) {
      next(new AppError('User ID is required', 400));
      return;
    }

    // Check if trying to block self
    if (userId === currentUserId) {
      next(new AppError('You cannot block yourself', 400));
      return;
    }

    // Find both users
    const [currentUser, userToBlock] = await Promise.all([
      User.findById(currentUserId),
      User.findById(userId)
    ]);

    if (!currentUser) {
      next(new AppError('Current user not found', 404));
      return;
    }

    if (!userToBlock) {
      next(new AppError('User not found', 404));
      return;
    }

    const userToBlockObjectId = new mongoose.Types.ObjectId(userId);
    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    // Check if already blocked
    if (currentUser.blockedUsers?.includes(userToBlockObjectId)) {
      next(new AppError('User is already blocked', 400));
      return;
    }

    // Initialize arrays if they don't exist
    if (!currentUser.blockedUsers) currentUser.blockedUsers = [];
    if (!userToBlock.blockedBy) userToBlock.blockedBy = [];

    // 1. Add to blocked users list
    currentUser.blockedUsers.push(userToBlockObjectId);
    userToBlock.blockedBy.push(currentUserObjectId);

    // 2. Remove from followers/following if connected
    if (currentUser.following?.includes(userToBlockObjectId)) {
      currentUser.following = currentUser.following.filter(
        id => !id.equals(userToBlockObjectId)
      );
      currentUser.followingCount = Math.max(0, currentUser.followingCount - 1);
    }

    if (currentUser.followers?.includes(userToBlockObjectId)) {
      currentUser.followers = currentUser.followers.filter(
        id => !id.equals(userToBlockObjectId)
      );
      currentUser.followersCount = Math.max(0, currentUser.followersCount - 1);
    }

    if (userToBlock.following?.includes(currentUserObjectId)) {
      userToBlock.following = userToBlock.following.filter(
        id => !id.equals(currentUserObjectId)
      );
      userToBlock.followingCount = Math.max(0, userToBlock.followingCount - 1);
    }

    if (userToBlock.followers?.includes(currentUserObjectId)) {
      userToBlock.followers = userToBlock.followers.filter(
        id => !id.equals(currentUserObjectId)
      );
      userToBlock.followersCount = Math.max(0, userToBlock.followersCount - 1);
    }

    // 3. Cancel any pending follow requests
    if (currentUser.followRequests?.sent?.includes(userToBlockObjectId)) {
      currentUser.followRequests.sent = currentUser.followRequests.sent.filter(
        id => !id.equals(userToBlockObjectId)
      );
    }

    if (currentUser.followRequests?.received?.includes(userToBlockObjectId)) {
      currentUser.followRequests.received = currentUser.followRequests.received.filter(
        id => !id.equals(userToBlockObjectId)
      );
    }

    if (userToBlock.followRequests?.sent?.includes(currentUserObjectId)) {
      userToBlock.followRequests.sent = userToBlock.followRequests.sent.filter(
        id => !id.equals(currentUserObjectId)
      );
    }

    if (userToBlock.followRequests?.received?.includes(currentUserObjectId)) {
      userToBlock.followRequests.received = userToBlock.followRequests.received.filter(
        id => !id.equals(currentUserObjectId)
      );
    }

    // Save both users
    await Promise.all([currentUser.save(), userToBlock.save()]);

    res.status(200).json({
      status: 'success',
      message: 'User blocked successfully',
      data: {
        blockedUser: {
          id: userToBlock._id,
          username: userToBlock.username,
          fullName: userToBlock.fullName,
          avatar: userToBlock.avatar
        }
      }
    });
  }
);

/**
 * Unblock a user
 */
export const unblockUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check validation errors

    const { userId } = req.params;
    const currentUserId = req.user?.id;

    // Ensure userId exists
    if (!userId) {
      next(new AppError('User ID is required', 400));
      return;
    }

    // Check if trying to unblock self
    if (userId === currentUserId) {
      next(new AppError('You cannot unblock yourself', 400));
      return;
    }

    // Find both users
    const [currentUser, userToUnblock] = await Promise.all([
      User.findById(currentUserId),
      User.findById(userId)
    ]);

    if (!currentUser) {
      next(new AppError('Current user not found', 404));
      return;
    }

    if (!userToUnblock) {
      next(new AppError('User not found', 404));
      return;
    }

    const userToUnblockObjectId = new mongoose.Types.ObjectId(userId);
    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    // Check if actually blocked
    if (!currentUser.blockedUsers?.includes(userToUnblockObjectId)) {
      next(new AppError('User is not blocked', 400));
      return;
    }

    // Remove from blocked users list
    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      id => !id.equals(userToUnblockObjectId)
    );

    if (userToUnblock.blockedBy) {
      userToUnblock.blockedBy = userToUnblock.blockedBy.filter(
        id => !id.equals(currentUserObjectId)
      );
    }

    // Save both users
    await Promise.all([currentUser.save(), userToUnblock.save()]);

    res.status(200).json({
      status: 'success',
      message: 'User unblocked successfully',
      data: {
        unblockedUser: {
          id: userToUnblock._id,
          username: userToUnblock.username,
          fullName: userToUnblock.fullName,
          avatar: userToUnblock.avatar
        }
      }
    });
  }
);

/**
 * Get blocked users list
 */
export const getBlockedUsers = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      next(new AppError('User ID is required', 400));
      return;
    }

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const user = await User.findById(currentUserId)
      .populate({
        path: 'blockedUsers',
        select: 'username fullName avatar',
        options: {
          skip: skip,
          limit: limit
        }
      });

    if (!user) {
      next(new AppError('User not found', 404));
      return;
    }

    const totalBlocked = user.blockedUsers?.length || 0;
    const totalPages = Math.ceil(totalBlocked / limit);

    res.status(200).json({
      status: 'success',
      data: {
        blockedUsers: user.blockedUsers || [],
        pagination: {
          page,
          limit,
          totalBlocked,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  }
);

/**
 * Remove a follower
 * This allows users to remove someone from their followers list
 */
export const removeFollower = catchAsync(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check validation errors

    const { userId } = req.params;
    const currentUserId = req.user?.id;

    // Ensure userId exists
    if (!userId) {
      next(new AppError('User ID is required', 400));
      return;
    }

    // Check if trying to remove self
    if (userId === currentUserId) {
      next(new AppError('You cannot remove yourself', 400));
      return;
    }

    // Find both users
    const [currentUser, followerToRemove] = await Promise.all([
      User.findById(currentUserId),
      User.findById(userId)
    ]);

    if (!currentUser) {
      next(new AppError('Current user not found', 404));
      return;
    }

    if (!followerToRemove) {
      next(new AppError('User not found', 404));
      return;
    }

    const followerObjectId = new mongoose.Types.ObjectId(userId);
    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    // Check if user is actually following
    if (!currentUser.followers?.includes(followerObjectId)) {
      next(new AppError('This user is not following you', 400));
      return;
    }

    // Remove from followers/following
    currentUser.followers = currentUser.followers.filter(
      id => !id.equals(followerObjectId)
    );
    currentUser.followersCount = Math.max(0, currentUser.followersCount - 1);

    followerToRemove.following = followerToRemove.following.filter(
      id => !id.equals(currentUserObjectId)
    );
    followerToRemove.followingCount = Math.max(0, followerToRemove.followingCount - 1);

    await Promise.all([currentUser.save(), followerToRemove.save()]);

    res.status(200).json({
      status: 'success',
      message: 'Follower removed successfully',
      data: {
        removedFollower: {
          id: followerToRemove._id,
          username: followerToRemove.username,
          fullName: followerToRemove.fullName,
          avatar: followerToRemove.avatar
        },
        followersCount: currentUser.followersCount
      }
    });
  }
);