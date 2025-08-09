// services/chat-service/src/controllers/conversation.controller.ts
import { Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { ConversationModel, IConversation } from '../models/conversation.model.js';
import { MessageModel } from '../models/message.model.js';
import { RedisService } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';
import { AuthenticatedRequest } from '../middlewares/authMiddleware.js';

// Interfaces for request bodies
interface CreateConversationBody {
  participants: string[];
  conversationType: 'direct' | 'group';
  groupInfo?: {
    name: string;
    description?: string;
    avatar?: string;
  };
}

interface UpdateConversationBody {
  name?: string;
  description?: string;
  avatar?: string;
}

interface AddParticipantsBody {
  participantIds: string[];
}

// Interface for populated participant
interface PopulatedParticipant {
  _id: Types.ObjectId;
  name: string;
  avatar?: string;
  email: string;
  lastSeen?: Date;
}

// Interface for conversation with populated fields
interface PopulatedConversation extends Omit<IConversation, 'participants'> {
  participants: PopulatedParticipant[];
}

export class ConversationController {
  /**
   * Create a new conversation
   */
  public static async createConversation(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { participants, conversationType, groupInfo }: CreateConversationBody = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      // Validation
      if (!Array.isArray(participants) || participants.length === 0) {
        return next(new AppError('Participants array is required and cannot be empty', 400));
      }

      if (participants.length > 50) {
        return next(new AppError('Participants cannot exceed 50 users', 400));
      }

      // Validate conversation type - FIXED LOGIC ERROR
      if (!['direct', 'group'].includes(conversationType)) {
        return next(new AppError('Invalid conversation type. Must be "direct" or "group"', 400));
      }

      // Ensure creator is in participants
      const allParticipants = [...new Set([userId, ...participants])];

      // Type-specific validations
      if (conversationType === 'direct' && allParticipants.length !== 2) {
        return next(new AppError('Direct conversation must have exactly 2 participants', 400));
      }

      if (conversationType === 'group') {
        if (allParticipants.length < 3) {
          return next(new AppError('Group conversation must have at least 3 participants', 400));
        }

        if (!groupInfo || !groupInfo.name?.trim()) {
          return next(new AppError('Group name is required for group conversations', 400));
        }

        const trimmedName = groupInfo.name.trim();
        if (trimmedName.length < 3 || trimmedName.length > 50) {
          return next(new AppError('Group name must be between 3 and 50 characters', 400));
        }

        if (groupInfo.description) {
          const trimmedDesc = groupInfo.description.trim();
          if (trimmedDesc.length < 3 || trimmedDesc.length > 100) {
            return next(new AppError('Group description must be between 3 and 100 characters', 400));
          }
        }
      }

      // Check if direct conversation already exists
      if (conversationType === 'direct') {
        const existingConversation = await ConversationModel.findOne({
          conversationType: 'direct',
          participants: { $all: allParticipants.map(id => new Types.ObjectId(id)), $size: 2 }
        }).populate('participants', 'name avatar email');

        if (existingConversation) {
          res.json({
            success: true,
            message: 'Conversation already exists',
            data: existingConversation
          });
          return;
        }
      }

      // Create conversation data
      const conversationData: Partial<IConversation> = {
        participants: allParticipants.map(id => new Types.ObjectId(id)),
        conversationType,
        lastActivity: new Date(),
        isArchived: false,
        mutedBy: [],
        pinnedBy: [],
        settings: {
          messageRetention: 30,
          allowMediaSharing: true,
          allowFileSharing: true
        },
        metadata: {
          totalMessages: 0,
          mediaCount: 0,
          fileCount: 0
        }
      };

      // Add group info if it's a group conversation
      if (conversationType === 'group' && groupInfo) {
        conversationData.groupInfo = {
          name: groupInfo.name.trim(),
          ...(typeof groupInfo.description === 'string' ? { description: groupInfo.description.trim() } : {}),
          ...(typeof groupInfo.avatar === 'string' ? { avatar: groupInfo.avatar } : {}),
          admin: new Types.ObjectId(userId),
          members: allParticipants.map(participantId => ({
            userId: new Types.ObjectId(participantId),
            role: participantId === userId ? ('admin' as const) : ('member' as const),
            joinedAt: new Date()
          }))
        };
      }

      const conversation = new ConversationModel(conversationData);
      await conversation.save();

      // Populate participants
      await conversation.populate('participants', 'name avatar email');
      if (conversationType === 'group') {
        await conversation.populate('groupInfo.admin', 'name avatar email');
        await conversation.populate('groupInfo.members.userId', 'name avatar email');
      }

      // Add participants to conversation in Redis
      for (const participantId of allParticipants) {
        await RedisService.addUserToConversation(participantId, conversation._id.toString());
      }

      // Send real-time notification to other participants (exclude creator)
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        const otherParticipants = allParticipants.filter(id => id !== userId);
        for (const participantId of otherParticipants) {
          await wsManager.sendMessageToUser(participantId, {
            type: 'CONVERSATION_CREATED',
            data: conversation,
            timestamp: Date.now()
          });
        }
      }

      res.status(201).json({
        success: true,
        message: 'Conversation created successfully',
        data: conversation
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's conversations
   */
  public static async getUserConversations(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      const page = parseInt((req.query.page as string) || '1');
      const limit = Math.min(parseInt((req.query.limit as string) || '20'), 50); // Max 50 per page
      const skip = (page - 1) * limit;

      const conversations = await ConversationModel.find({
        participants: new Types.ObjectId(userId),
        isArchived: false
      })
      .populate('participants', 'name avatar email lastSeen')
      .populate('lastMessage')
      .populate('groupInfo.admin', 'name avatar email')
      .sort({ lastActivity: -1 })
      .skip(skip)
      .limit(limit)
      .lean() as PopulatedConversation[];

      // Get total count
      const totalConversations = await ConversationModel.countDocuments({
        participants: new Types.ObjectId(userId),
        isArchived: false
      });

      // Get unread message counts and participant statuses
      const conversationsWithUnread = await Promise.all(
        conversations.map(async (conversation) => {
          const unreadCount = await MessageModel.countDocuments({
            conversationId: conversation._id,
            senderId: { $ne: new Types.ObjectId(userId) },
            'status.read': { $size: 0 },
            isDeleted: false,
            deletedFor: { $ne: new Types.ObjectId(userId) }
          });

          // Get online status for participants
          const participantStatuses = await RedisService.getMultipleUserStatuses(
            conversation.participants.map((p: PopulatedParticipant) => p._id.toString())
          );

          return {
            ...conversation,
            unreadCount,
            participantStatuses
          };
        })
      );

      res.json({
        success: true,
        data: {
          conversations: conversationsWithUnread,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalConversations / limit),
            totalConversations,
            hasNextPage: page < Math.ceil(totalConversations / limit),
            hasPrevPage: page > 1
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get conversation details
   */
  public static async getConversationDetails(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId)) {
        return next(new AppError('Invalid conversation ID', 400));
      }

      const conversation = await ConversationModel.findById(conversationId)
        .populate('participants', 'name avatar email lastSeen')
        .populate('lastMessage')
        .populate('groupInfo.admin', 'name avatar email')
        .populate('groupInfo.members.userId', 'name avatar email') as PopulatedConversation | null;

      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      // Check if user is a participant
      const isParticipant = conversation.participants.some(
        (p: PopulatedParticipant) => p._id.toString() === userId
      );

      if (!isParticipant) {
        return next(new AppError('Access denied', 403));
      }

      // Get participant statuses
      const participantStatuses = await RedisService.getMultipleUserStatuses(
        conversation.participants.map((p: PopulatedParticipant) => p._id.toString())
      );

      // Get unread count
      const unreadCount = await MessageModel.countDocuments({
        conversationId,
        senderId: { $ne: new Types.ObjectId(userId) },
        'status.read': { $size: 0 },
        isDeleted: false,
        deletedFor: { $ne: new Types.ObjectId(userId) }
      });

      res.json({
        success: true,
        data: {
          ...conversation,
          unreadCount,
          participantStatuses
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Update conversation (only for groups)
   */
  public static async updateConversation(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { name, description, avatar }: UpdateConversationBody = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId)) {
        return next(new AppError('Invalid conversation ID', 400));
      }

      // Validation
      if (name !== undefined) {
        const trimmedName = name.trim();
        if (trimmedName.length < 3 || trimmedName.length > 100) {
          return next(new AppError('Group name must be between 3 and 100 characters', 400));
        }
      }

      if (description !== undefined && description.length > 500) {
        return next(new AppError('Group description cannot be longer than 500 characters', 400));
      }

      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      // Only group conversations can be updated
      if (conversation.conversationType !== 'group') {
        return next(new AppError('Only group conversations can be updated', 400));
      }

      // Check if user is admin
      if (conversation.groupInfo?.admin.toString() !== userId) {
        return next(new AppError('Only group admin can update conversation', 403));
      }

      // Update group info
      if (conversation.groupInfo) {
        if (name !== undefined) conversation.groupInfo.name = name.trim();
        if (description !== undefined) conversation.groupInfo.description = description?.trim();
        if (avatar !== undefined) conversation.groupInfo.avatar = avatar;
      }

      conversation.updatedAt = new Date();
      await conversation.save();

      await conversation.populate('participants', 'name avatar email');
      await conversation.populate('groupInfo.admin', 'name avatar email');

      // Send real-time update
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        await wsManager.broadcastToConversation(conversationId, {
          type: 'CONVERSATION_UPDATED',
          data: conversation,
          timestamp: Date.now()
        });
      }

      res.json({
        success: true,
        message: 'Conversation updated successfully',
        data: conversation
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Add participants to group conversation
   */
  public static async addParticipants(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { participantIds }: AddParticipantsBody = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId)) {
        return next(new AppError('Invalid conversation ID', 400));
      }

      if (!Array.isArray(participantIds) || participantIds.length === 0) {
        return next(new AppError('Participant IDs are required and must be an array', 400));
      }

      if (participantIds.length > 20) {
        return next(new AppError('Cannot add more than 20 participants at once', 400));
      }

      // Validate participant IDs
      for (const id of participantIds) {
        if (!Types.ObjectId.isValid(id)) {
          return next(new AppError(`Invalid participant ID: ${id}`, 400));
        }
      }

      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      // Only group conversations
      if (conversation.conversationType !== 'group') {
        return next(new AppError('Can only add participants to group conversations', 400));
      }

      // Check if user is admin
      if (conversation.groupInfo?.admin.toString() !== userId) {
        return next(new AppError('Only group admin can add participants', 403));
      }

      // Check total participant limit
      const totalAfterAdd = conversation.participants.length + participantIds.length;
      if (totalAfterAdd > 50) {
        return next(new AppError('Group cannot have more than 50 participants', 400));
      }

      // Filter out existing participants
      const existingParticipantIds = conversation.participants.map(p => p.toString());
      const newParticipantIds = participantIds.filter(id => 
        !existingParticipantIds.includes(id)
      );

      if (newParticipantIds.length === 0) {
        return next(new AppError('All users are already participants', 400));
      }

      // Add to participants array
      conversation.participants.push(
        ...newParticipantIds.map(id => new Types.ObjectId(id))
      );

      // Add to group members
      if (conversation.groupInfo) {
        const newMembers = newParticipantIds.map(id => ({
          userId: new Types.ObjectId(id),
          role: 'member' as const,
          joinedAt: new Date()
        }));
        conversation.groupInfo.members.push(...newMembers);
      }

      conversation.lastActivity = new Date();
      await conversation.save();

      await conversation.populate('participants', 'name avatar email');
      await conversation.populate('groupInfo.members.userId', 'name avatar email');

      // Add to Redis
      for (const participantId of newParticipantIds) {
        await RedisService.addUserToConversation(participantId, conversationId);
      }

      // Send real-time notifications
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        // Notify existing participants
        await wsManager.broadcastToConversation(conversationId, {
          type: 'PARTICIPANTS_ADDED',
          data: {
            conversationId,
            addedParticipants: newParticipantIds,
            addedBy: userId
          },
          timestamp: Date.now()
        });

        // Notify new participants
        for (const participantId of newParticipantIds) {
          await wsManager.sendMessageToUser(participantId, {
            type: 'ADDED_TO_CONVERSATION',
            data: conversation,
            timestamp: Date.now()
          });
        }
      }

      res.json({
        success: true,
        message: 'Participants added successfully',
        data: {
          conversation,
          addedParticipants: newParticipantIds
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove participant from group conversation
   */
  public static async removeParticipant(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId, participantId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(participantId)) {
        return next(new AppError('Invalid conversation or participant ID', 400));
      }

      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      // Only group conversations
      if (conversation.conversationType !== 'group') {
        return next(new AppError('Can only remove participants from group conversations', 400));
      }

      // Check if participant exists in conversation
      if (!conversation.participants.some(p => p.toString() === participantId)) {
        return next(new AppError('User is not a participant in this conversation', 400));
      }

      // Check permissions (admin can remove anyone, users can remove themselves)
      const isAdmin = conversation.groupInfo?.admin.toString() === userId;
      const isSelfRemoval = participantId === userId;

      if (!isAdmin && !isSelfRemoval) {
        return next(new AppError('You can only remove yourself or must be admin', 403));
      }

      // Can't remove admin
      if (participantId === conversation.groupInfo?.admin.toString()) {
        return next(new AppError('Cannot remove group admin', 400));
      }

      // Check minimum participants for group
      if (conversation.participants.length <= 3) {
        return next(new AppError('Group must have at least 3 participants', 400));
      }

      // Remove from participants
      conversation.participants = conversation.participants.filter(
        p => p.toString() !== participantId
      );

      // Remove from group members
      if (conversation.groupInfo) {
        conversation.groupInfo.members = conversation.groupInfo.members.filter(
          m => m.userId.toString() !== participantId
        );
      }

      conversation.lastActivity = new Date();
      await conversation.save();

      // Remove from Redis
      await RedisService.removeUserFromConversation(participantId, conversationId);

      // Send real-time notifications
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        // Notify remaining participants
        await wsManager.broadcastToConversation(conversationId, {
          type: 'PARTICIPANT_REMOVED',
          data: {
            conversationId,
            removedParticipant: participantId,
            removedBy: userId,
            isSelfRemoval
          },
          timestamp: Date.now()
        });

        // Notify removed participant
        await wsManager.sendMessageToUser(participantId, {
          type: 'REMOVED_FROM_CONVERSATION',
          data: {
            conversationId,
            removedBy: userId,
            isSelfRemoval
          },
          timestamp: Date.now()
        });
      }

      res.json({
        success: true,
        message: isSelfRemoval ? 'Left conversation successfully' : 'Participant removed successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Archive/Unarchive conversation
   */
  public static async toggleArchive(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId)) {
        return next(new AppError('Invalid conversation ID', 400));
      }

      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      // Check if user is participant
      if (!conversation.participants.some(p => p.toString() === userId)) {
        return next(new AppError('Access denied', 403));
      }

      conversation.isArchived = !conversation.isArchived;
      await conversation.save();

      res.json({
        success: true,
        message: `Conversation ${conversation.isArchived ? 'archived' : 'unarchived'} successfully`,
        data: { isArchived: conversation.isArchived }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Mute/Unmute conversation
   */
  public static async toggleMute(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId)) {
        return next(new AppError('Invalid conversation ID', 400));
      }

      const userObjectId = new Types.ObjectId(userId);
      const conversation = await ConversationModel.findById(conversationId);
      
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      // Check if user is participant
      if (!conversation.participants.some(p => p.equals(userObjectId))) {
        return next(new AppError('Access denied', 403));
      }

      const isMuted = conversation.mutedBy.some(id => id.equals(userObjectId));
      
      if (isMuted) {
        conversation.mutedBy = conversation.mutedBy.filter(id => !id.equals(userObjectId));
      } else {
        conversation.mutedBy.push(userObjectId);
      }

      await conversation.save();

      res.json({
        success: true,
        message: `Conversation ${!isMuted ? 'muted' : 'unmuted'} successfully`,
        data: { isMuted: !isMuted }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Pin/Unpin conversation
   */
  public static async togglePin(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId)) {
        return next(new AppError('Invalid conversation ID', 400));
      }

      const userObjectId = new Types.ObjectId(userId);
      const conversation = await ConversationModel.findById(conversationId);
      
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      // Check if user is participant
      if (!conversation.participants.some(p => p.equals(userObjectId))) {
        return next(new AppError('Access denied', 403));
      }

      const isPinned = conversation.pinnedBy.some(id => id.equals(userObjectId));
      
      if (isPinned) {
        conversation.pinnedBy = conversation.pinnedBy.filter(id => !id.equals(userObjectId));
      } else {
        conversation.pinnedBy.push(userObjectId);
      }

      await conversation.save();

      res.json({
        success: true,
        message: `Conversation ${!isPinned ? 'pinned' : 'unpinned'} successfully`,
        data: { isPinned: !isPinned }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete conversation
   */
  public static async deleteConversation(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId)) {
        return next(new AppError('Invalid conversation ID', 400));
      }

      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      // Only group admin or direct conversation participants can delete
      if (conversation.conversationType === 'group') {
        if (conversation.groupInfo?.admin.toString() !== userId) {
          return next(new AppError('Only group admin can delete group conversation', 403));
        }
      } else {
        if (!conversation.participants.some(p => p.toString() === userId)) {
          return next(new AppError('Access denied', 403));
        }
      }

      // Delete all messages in conversation
      await MessageModel.deleteMany({ conversationId });

      // Remove from Redis for all participants
      for (const participant of conversation.participants) {
        await RedisService.removeUserFromConversation(participant.toString(), conversationId);
      }

      // Delete conversation
      await ConversationModel.findByIdAndDelete(conversationId);

      // Send real-time notification
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        await wsManager.broadcastToConversation(conversationId, {
          type: 'CONVERSATION_DELETED',
          data: {
            conversationId,
            deletedBy: userId
          },
          timestamp: Date.now()
        });
      }

      res.json({
        success: true,
        message: 'Conversation deleted successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get conversation typing users
   */
  public static async getTypingUsers(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('Authentication required', 401));
      }

      if (!Types.ObjectId.isValid(conversationId)) {
        return next(new AppError('Invalid conversation ID', 400));
      }

      // Verify access
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.some(p => p.toString() === userId)) {
        return next(new AppError('Access denied', 403));
      }

      const typingUsers = await RedisService.getTypingUsers(conversationId);

      res.json({
        success: true,
        data: {
          typingUsers: typingUsers.filter(id => id !== userId) // Exclude self
        }
      });

    } catch (error) {
      next(error);
    }
  }
}