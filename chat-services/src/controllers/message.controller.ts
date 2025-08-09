// services/chat-service/src/controllers/message.controller.ts
import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { MessageModel, IMessage, IMediaFile } from '../models/message.model.js';
import { ConversationModel } from '../models/conversation.model.js';
import { MediaUploadService } from '../utils/mediaUploadService.js';
import { MediaProcessor } from '../utils/mediaProcessor.js';
import { RedisService } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';
import { MulterFile } from '../types/multerType.js';

// Updated interface to match your middleware
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
    role?: string;
  };
}

// Interface for request body types
interface SendMessageBody {
  conversationId: string;
  content?: string;
  messageType?: 'text' | 'image' | 'video' | 'document' | 'audio';
  replyTo?: string;
}

interface EditMessageBody {
  content: string;
}

interface DeleteMessageBody {
  deleteFor: 'me' | 'everyone';
}

interface ReactionBody {
  emoji: string;
}

interface ForwardMessageBody {
  conversationIds: string[];
}

// Interface for query parameters
interface MessageQueryParams {
  page?: string;
  limit?: string;
  query?: string;
  messageType?: 'text' | 'image' | 'video' | 'document' | 'audio';
  dateFrom?: string;
  dateTo?: string;
}

// Type for media upload result
interface MediaUploadResult {
  key: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
  };
}

// Type for processed media file (matching your model)
type ProcessedMediaFile = IMediaFile;

// Type for message aggregation result
interface MessageStatsResult {
  _id: null;
  totalMessages: number;
  textMessages: number;
  imageMessages: number;
  videoMessages: number;
  documentMessages: number;
  audioMessages: number;
}

export class MessageController {
  /**
   * Send a new message
   */
  public static async sendMessage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { conversationId, content, messageType, replyTo } = req.body as SendMessageBody;
      const senderId = req.user?.id as string;
      const files = req.files as MulterFile[] | undefined;

      if (!conversationId) {
        return next(new AppError('Conversation ID is required', 400));
      }

      // Verify conversation exists and user is participant
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(senderId))) {
        return next(new AppError('You are not a participant in this conversation', 403));
      }

      // Validate message content for text messages
      if (messageType === 'text' || !messageType) {
        if (!content || content.trim().length === 0) {
          return next(new AppError('Message content is required for text messages', 400));
        }
        if (content.length > 4000) {
          return next(new AppError('Message content cannot exceed 4000 characters', 400));
        }
      }

      // Handle media uploads if files are present
      let mediaFiles: ProcessedMediaFile[] = [];
      if (files && files.length > 0) {
        if (files.length > 10) {
          return next(new AppError('Cannot upload more than 10 files at once', 400));
        }
        mediaFiles = await MessageController.processMediaFiles(files, conversationId, senderId);
      }

      // Validate replyTo message if provided
      if (replyTo) {
        const replyMessage = await MessageModel.findOne({
          _id: replyTo,
          conversationId,
          isDeleted: false
        });
        if (!replyMessage) {
          return next(new AppError('Reply message not found', 404));
        }
      }

      // Determine message type
      const finalMessageType = messageType || (mediaFiles.length > 0 ? 'document' : 'text');

      // Create message
      const newMessage = new MessageModel({
        conversationId: new Types.ObjectId(conversationId),
        senderId: new Types.ObjectId(senderId),
        messageType: finalMessageType,
        content: content?.trim(),
        mediaFiles,
        replyTo: replyTo ? new Types.ObjectId(replyTo) : undefined,
        status: {
          sent: new Date(),
          delivered: [],
          read: []
        }
      });

      const savedMessage = await newMessage.save();
      
      // Populate sender info
      await savedMessage.populate('senderId', 'name avatar email');
      if (replyTo) {
        await savedMessage.populate('replyTo');
      }

      // Update conversation
      const updateData: Record<string, unknown> = {
        lastMessage: savedMessage._id,
        lastActivity: new Date(),
        $inc: { 
          'metadata.totalMessages': 1
        }
      };

      // Update counters based on message type
      if (finalMessageType === 'image' || finalMessageType === 'video') {
        (updateData.$inc as Record<string, number>)['metadata.mediaCount'] = 1;
      } else if (finalMessageType === 'document') {
        (updateData.$inc as Record<string, number>)['metadata.fileCount'] = 1;
      }

      await ConversationModel.findByIdAndUpdate(conversationId, updateData);

      // Cache message in Redis
      await RedisService.cacheMessage(savedMessage._id.toString(), savedMessage.toObject());

      // Send real-time notification via WebSocket
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        await wsManager.broadcastToConversation(conversationId, {
          type: 'NEW_MESSAGE',
          data: savedMessage,
          timestamp: Date.now()
        }, senderId);
      }

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: savedMessage
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get messages for a conversation with pagination
   */
  public static async getMessages(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id as string;
      const { page = '1', limit = '50' } = req.query as MessageQueryParams;
      
      const pageNum = parseInt(page) || 1;
      const limitNum = Math.min(parseInt(limit) || 50, 100); // Max 100 messages per request
      const skip = (pageNum - 1) * limitNum;

      if (!conversationId) {
        return next(new AppError('Conversation ID is required', 400));
      }

      // Verify user is participant
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied', 403));
      }

      // Get messages with pagination
      const messages = await MessageModel.find({
        conversationId,
        $or: [
          { isDeleted: false },
          { isDeleted: true, deletedFor: { $ne: new Types.ObjectId(userId) } }
        ]
      })
      .populate('senderId', 'name avatar email')
      .populate('replyTo')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

      // Get total count
      const totalMessages = await MessageModel.countDocuments({
        conversationId,
        $or: [
          { isDeleted: false },
          { isDeleted: true, deletedFor: { $ne: new Types.ObjectId(userId) } }
        ]
      });

      // Mark messages as delivered for this user
      await MessageController.markMessagesAsDelivered(conversationId, userId);

      res.json({
        success: true,
        data: {
          messages: messages.reverse(), // Reverse to show oldest first
          pagination: {
            currentPage: pageNum,
            totalPages: Math.ceil(totalMessages / limitNum),
            totalMessages,
            hasNextPage: pageNum < Math.ceil(totalMessages / limitNum),
            hasPrevPage: pageNum > 1
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Edit a message
   */
  public static async editMessage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { messageId } = req.params;
      const { content } = req.body as EditMessageBody;
      const userId = req.user?.id;

      if (!messageId) {
        return next(new AppError('Message ID is required', 400));
      }

      if (!content) {
        return next(new AppError('Message content is required', 400));
      }

      if (content.trim().length === 0) {
        return next(new AppError('Message content cannot be empty', 400));
      }

      if (content.length > 4000) {
        return next(new AppError('Message content cannot exceed 4000 characters', 400));
      }

      const message = await MessageModel.findById(messageId);

      if (!message) {
        return next(new AppError('Message not found', 404));
      }

      // Only sender can edit message
      if (message.senderId.toString() !== userId) {
        return next(new AppError('You can only edit your own messages', 403));
      }

      // Can't edit deleted messages
      if (message.isDeleted) {
        return next(new AppError('Cannot edit deleted message', 400));
      }

      // Can't edit non-text messages
      if (message.messageType !== 'text') {
        return next(new AppError('Only text messages can be edited', 400));
      }

      // Store edit history
      if (message.content) {
        message.editHistory.push({
          content: message.content,
          editedAt: new Date()
        });
      }

      // Update message
      message.content = content.trim();
      message.updatedAt = new Date();

      await message.save();
      await message.populate('senderId', 'name avatar email');

      // Update cache
      await RedisService.cacheMessage(messageId, message.toObject());

      // Send real-time update
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        await wsManager.broadcastToConversation(message.conversationId.toString(), {
          type: 'MESSAGE_EDITED',
          data: message,
          timestamp: Date.now()
        });
      }

      res.json({
        success: true,
        message: 'Message updated successfully',
        data: message
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a message
   */
  public static async deleteMessage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { messageId } = req.params;
      const { deleteFor } = req.body as DeleteMessageBody;
      const userId = req.user?.id;

      if (!messageId) {
        return next(new AppError('Message ID is required', 400));
      }

      if (!deleteFor || !['me', 'everyone'].includes(deleteFor)) {
        return next(new AppError('Delete for is required and must be "me" or "everyone"', 400));
      }

      const message = await MessageModel.findById(messageId);
      if (!message) {
        return next(new AppError('Message not found', 404));
      }

      // Verify user is participant
      const conversation = await ConversationModel.findById(message.conversationId);
      if (!conversation?.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied', 403));
      }

      if (deleteFor === 'everyone') {
        // Only sender can delete for everyone
        if (message.senderId.toString() !== userId) {
          return next(new AppError('You can only delete your own messages for everyone', 403));
        }

        // Mark as deleted and clear content
        message.isDeleted = true;
        message.content = undefined;

        // Delete media files from storage
        if (message.mediaFiles && message.mediaFiles.length > 0) {
          for (const mediaFile of message.mediaFiles) {
            try {
              await MediaUploadService.deleteMediaFiles(mediaFile);
            } catch (error) {
              console.error('Error deleting media file:', error);
            }
          }
          message.mediaFiles = [];
        }
      } else {
        // Delete for me only
        if (!message.deletedFor.includes(new Types.ObjectId(userId))) {
          message.deletedFor.push(new Types.ObjectId(userId));
        }
      }

      await message.save();

      // Send real-time update
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        if (deleteFor === 'everyone') {
          await wsManager.broadcastToConversation(message.conversationId.toString(), {
            type: 'MESSAGE_DELETED',
            data: { messageId, deletedBy: userId, deleteFor: 'everyone' },
            timestamp: Date.now()
          });
        } else {
          await wsManager.sendMessageToUser(userId, {
            type: 'MESSAGE_DELETED',
            data: { messageId, deleteFor: 'me' },
            timestamp: Date.now()
          });
        }
      }

      res.json({
        success: true,
        message: 'Message deleted successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Add/Remove reaction to a message
   */
  public static async toggleReaction(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { messageId } = req.params;
      const { emoji } = req.body as ReactionBody;
      const userId = new Types.ObjectId(req.user?.id);

      if (!messageId) {
        return next(new AppError('Message ID is required', 400));
      }

      if (!emoji || emoji.trim().length === 0) {
        return next(new AppError('Emoji is required', 400));
      }

      // Basic emoji validation (you might want to use a proper emoji library)
      if (emoji.length > 10) {
        return next(new AppError('Invalid emoji format', 400));
      }

      const message = await MessageModel.findById(messageId);
      if (!message) {
        return next(new AppError('Message not found', 404));
      }

      // Verify user is participant
      const conversation = await ConversationModel.findById(message.conversationId);
      if (!conversation?.participants.includes(userId)) {
        return next(new AppError('Access denied', 403));
      }

      // Find existing reaction
      const reactionIndex = message.reactions.findIndex(r => r.emoji === emoji);
      let action: 'add' | 'remove';

      if (reactionIndex === -1) {
        // Add new reaction
        message.reactions.push({
          emoji,
          users: [userId],
          count: 1
        });
        action = 'add';
      } else {
        const reaction = message.reactions[reactionIndex];
        const userIndex = reaction.users.findIndex(id => id.equals(userId));

        if (userIndex === -1) {
          // Add user to existing reaction
          reaction.users.push(userId);
          reaction.count++;
          action = 'add';
        } else {
          // Remove user from reaction
          reaction.users.splice(userIndex, 1);
          reaction.count--;
          
          // Remove reaction if no users left
          if (reaction.count === 0) {
            message.reactions.splice(reactionIndex, 1);
          }
          action = 'remove';
        }
      }

      await message.save();

      // Send real-time update
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        await wsManager.broadcastToConversation(message.conversationId.toString(), {
          type: 'MESSAGE_REACTION_UPDATED',
          data: {
            messageId,
            emoji,
            action,
            userId: req.user?.id,
            reactions: message.reactions
          },
          timestamp: Date.now()
        });
      }

      res.json({
        success: true,
        message: `Reaction ${action}ed successfully`,
        data: {
          messageId,
          reactions: message.reactions
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark message as read
   */
  public static async markAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { messageId } = req.params;
      const userId = req.user?.id;

      if (!messageId) {
        return next(new AppError('Message ID is required', 400));
      }

      const message = await MessageModel.findById(messageId);
      if (!message) {
        return next(new AppError('Message not found', 404));
      }

      // Verify user is participant
      const conversation = await ConversationModel.findById(message.conversationId);
      if (!conversation?.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied', 403));
      }

      // Don't mark own messages as read
      if (message.senderId.toString() === userId) {
        res.json({
          success: true,
          message: 'Cannot mark own message as read'
        });
        return;
      }

      // Add read timestamp if not already read by this user
      const readTime = new Date();
      const alreadyRead = message.status.read.some(readDate => {
        // Check if this user already read this message (within 1 second tolerance)
        return Math.abs(readDate.getTime() - readTime.getTime()) < 1000;
      });

      if (!alreadyRead) {
        message.status.read.push(readTime);
        await message.save();

        // Send real-time update to sender
        const wsManager = req.app.locals.wsManager;
        if (wsManager) {
          await wsManager.sendMessageToUser(message.senderId.toString(), {
            type: 'MESSAGE_READ',
            data: {
              messageId,
              readBy: userId,
              readAt: readTime
            },
            timestamp: Date.now()
          });
        }
      }

      res.json({
        success: true,
        message: 'Message marked as read'
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Forward a message
   */
  public static async forwardMessage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { messageId } = req.params;
      const { conversationIds } = req.body as ForwardMessageBody;
      const userId = req.user?.id;

      if (!messageId) {
        return next(new AppError('Message ID is required', 400));
      }

      if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
        return next(new AppError('Conversation IDs array is required', 400));
      }

      if (conversationIds.length > 10) {
        return next(new AppError('Cannot forward to more than 10 conversations at once', 400));
      }

      const originalMessage = await MessageModel.findById(messageId);
      if (!originalMessage) {
        return next(new AppError('Message not found', 404));
      }

      if (originalMessage.isDeleted) {
        return next(new AppError('Cannot forward deleted message', 400));
      }

      // Verify user has access to the original message
      const originalConversation = await ConversationModel.findById(originalMessage.conversationId);
      if (!originalConversation?.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied to original message', 403));
      }

      const forwardedMessages: IMessage[] = [];

      // Forward to each conversation
      for (const conversationId of conversationIds) {
        try {
          const conversation = await ConversationModel.findById(conversationId);
          if (!conversation) {
            console.warn(`Conversation ${conversationId} not found`);
            continue;
          }

          if (!conversation.participants.includes(new Types.ObjectId(userId))) {
            console.warn(`User ${userId} not participant in conversation ${conversationId}`);
            continue; // Skip if not a participant
          }

          const forwardedMessage = new MessageModel({
            conversationId: new Types.ObjectId(conversationId),
            senderId: new Types.ObjectId(userId),
            messageType: originalMessage.messageType,
            content: originalMessage.content,
            mediaFiles: originalMessage.mediaFiles,
            forwarded: {
              originalMessageId: originalMessage._id,
              forwardedFrom: originalMessage.senderId,
              forwardedAt: new Date()
            },
            status: {
              sent: new Date(),
              delivered: [],
              read: []
            }
          });

          const savedMessage = await forwardedMessage.save();
          await savedMessage.populate('senderId', 'name avatar email');
          await savedMessage.populate('forwarded.forwardedFrom', 'name avatar email');

          forwardedMessages.push(savedMessage);

          // Update conversation
          await ConversationModel.findByIdAndUpdate(conversationId, {
            lastMessage: savedMessage._id,
            lastActivity: new Date(),
            $inc: { 'metadata.totalMessages': 1 }
          });

          // Send real-time notification
          const wsManager = req.app.locals.wsManager;
          if (wsManager) {
            await wsManager.broadcastToConversation(conversationId, {
              type: 'NEW_MESSAGE',
              data: savedMessage,
              timestamp: Date.now()
            }, userId);
          }
        } catch (error) {
          console.error(`Error forwarding to conversation ${conversationId}:`, error);
          continue; // Continue with next conversation
        }
      }

      res.json({
        success: true,
        message: 'Message forwarded successfully',
        data: {
          forwardedTo: forwardedMessages.length,
          messages: forwardedMessages
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Search messages in a conversation
   */
  public static async searchMessages(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { query, messageType, dateFrom, dateTo, page = '1', limit = '20' } = req.query as MessageQueryParams;
      const userId = req.user?.id;

      if (!conversationId) {
        return next(new AppError('Conversation ID is required', 400));
      }

      const pageNum = parseInt(page) || 1;
      const limitNum = Math.min(parseInt(limit) || 20, 50); // Max 50 for search

      // Verify access
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied', 403));
      }

      // Build search criteria
      const searchCriteria: Record<string, unknown> = {
        conversationId,
        isDeleted: false,
        deletedFor: { $ne: new Types.ObjectId(userId) }
      };

      if (query && query.trim().length > 0) {
        searchCriteria.content = { $regex: query.trim(), $options: 'i' };
      }

      if (messageType && ['text', 'image', 'video', 'document', 'audio'].includes(messageType)) {
        searchCriteria.messageType = messageType;
      }

      if (dateFrom || dateTo) {
        searchCriteria.createdAt = {};
        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          if (!isNaN(fromDate.getTime())) {
            (searchCriteria.createdAt as Record<string, unknown>).$gte = fromDate;
          }
        }
        if (dateTo) {
          const toDate = new Date(dateTo);
          if (!isNaN(toDate.getTime())) {
            (searchCriteria.createdAt as Record<string, unknown>).$lte = toDate;
          }
        }
      }

      const messages = await MessageModel.find(searchCriteria)
        .populate('senderId', 'name avatar email')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean();

      const totalResults = await MessageModel.countDocuments(searchCriteria);

      res.json({
        success: true,
        data: {
          messages,
          pagination: {
            currentPage: pageNum,
            totalPages: Math.ceil(totalResults / limitNum),
            totalResults,
            hasNextPage: pageNum < Math.ceil(totalResults / limitNum),
            hasPrevPage: pageNum > 1
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get message statistics
   */
  public static async getMessageStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;

      if (!conversationId) {
        return next(new AppError('Conversation ID is required', 400));
      }

      // Verify access
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied', 403));
      }

      const stats = await MessageModel.aggregate([
        {
          $match: {
            conversationId: new Types.ObjectId(conversationId),
            isDeleted: false
          }
        },
        {
          $group: {
            _id: null,
            totalMessages: { $sum: 1 },
            textMessages: {
              $sum: { $cond: [{ $eq: ['$messageType', 'text'] }, 1, 0] }
            },
            imageMessages: {
              $sum: { $cond: [{ $eq: ['$messageType', 'image'] }, 1, 0] }
            },
            videoMessages: {
              $sum: { $cond: [{ $eq: ['$messageType', 'video'] }, 1, 0] }
            },
            documentMessages: {
              $sum: { $cond: [{ $eq: ['$messageType', 'document'] }, 1, 0] }
            },
            audioMessages: {
              $sum: { $cond: [{ $eq: ['$messageType', 'audio'] }, 1, 0] }
            }
          }
        }
      ]);

      const result = stats[0] as MessageStatsResult || {
        _id: null,
        totalMessages: 0,
        textMessages: 0,
        imageMessages: 0,
        videoMessages: 0,
        documentMessages: 0,
        audioMessages: 0
      };

      res.json({
        success: true,
        data: {
          totalMessages: result.totalMessages,
          textMessages: result.textMessages,
          imageMessages: result.imageMessages,
          videoMessages: result.videoMessages,
          documentMessages: result.documentMessages,
          audioMessages: result.audioMessages
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Bulk mark messages as read for a conversation
   */
  public static async bulkMarkAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;

      if (!conversationId) {
        return next(new AppError('Conversation ID is required', 400));
      }

      // Verify access
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied', 403));
      }

      // Mark all unread messages as read
      const result = await MessageModel.updateMany(
        {
          conversationId: new Types.ObjectId(conversationId),
          senderId: { $ne: new Types.ObjectId(userId) },
          'status.read': { $size: 0 },
          isDeleted: false,
          deletedFor: { $ne: new Types.ObjectId(userId) }
        },
        {
          $push: { 'status.read': new Date() }
        }
      );

      res.json({
        success: true,
        message: 'Messages marked as read successfully',
        data: {
          markedCount: result.modifiedCount
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get unread message count for user
   */
  public static async getUnreadCount(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return next(new AppError('User ID is required', 400));
      }

      // Get all conversations where user is participant
      const conversations = await ConversationModel.find({
        participants: new Types.ObjectId(userId),
        isArchived: false
      }).select('_id');

      const conversationIds = conversations.map(c => c._id);

      // Get unread count for each conversation
      const unreadCounts = await MessageModel.aggregate([
        {
          $match: {
            conversationId: { $in: conversationIds },
            senderId: { $ne: new Types.ObjectId(userId) },
            'status.read': { $size: 0 },
            isDeleted: false,
            deletedFor: { $ne: new Types.ObjectId(userId) }
          }
        },
        {
          $group: {
            _id: '$conversationId',
            count: { $sum: 1 }
          }
        }
      ]);

      const totalUnread = unreadCounts.reduce((total, item) => total + item.count, 0);

      // Format response
      const conversationUnreadMap = unreadCounts.reduce((acc, item) => {
        acc[item._id.toString()] = item.count;
        return acc;
      }, {} as Record<string, number>);

      res.json({
        success: true,
        data: {
          totalUnread,
          conversationUnreadCounts: conversationUnreadMap
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get message delivery status
   */
  public static async getMessageDeliveryStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { messageId } = req.params;
      const userId = req.user?.id;

      if (!messageId) {
        return next(new AppError('Message ID is required', 400));
      }

      const message = await MessageModel.findById(messageId)
        .populate('senderId', 'name avatar email');

      if (!message) {
        return next(new AppError('Message not found', 404));
      }

      // Only sender can check delivery status
      if (message.senderId._id.toString() !== userId) {
        return next(new AppError('You can only check delivery status of your own messages', 403));
      }

      // Get conversation to count participants
      const conversation = await ConversationModel.findById(message.conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      const totalParticipants = conversation.participants.length - 1; // Exclude sender

      res.json({
        success: true,
        data: {
          messageId,
          sent: message.status.sent,
          delivered: {
            count: message.status.delivered.length,
            total: totalParticipants,
            timestamps: message.status.delivered
          },
          read: {
            count: message.status.read.length,
            total: totalParticipants,
            timestamps: message.status.read
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Private helper methods
   */
  private static async processMediaFiles(
    files: MulterFile[], 
    conversationId: string, 
    userId: string
  ): Promise<ProcessedMediaFile[]> {
    const mediaFiles: ProcessedMediaFile[] = [];

    for (const file of files) {
      try {
        let uploadResult: MediaUploadResult;

        if (file.mimetype.startsWith('image/')) {
          MediaProcessor.validateMediaFile(file, 'image');
          uploadResult = await MediaUploadService.uploadImage(file, conversationId, userId);
        } else if (file.mimetype.startsWith('video/')) {
          MediaProcessor.validateMediaFile(file, 'video');
          uploadResult = await MediaUploadService.uploadVideo(file, conversationId, userId);
        } else if (file.mimetype.startsWith('audio/')) {
          MediaProcessor.validateMediaFile(file, 'audio');
          uploadResult = await MediaUploadService.uploadAudio(file, conversationId, userId);
        } else {
          MediaProcessor.validateMediaFile(file, 'document');
          uploadResult = await MediaUploadService.uploadDocument(file, conversationId, userId);
        }

      } catch (error) {
        console.error('Media processing error:', error);
        throw new AppError(`Failed to process file: ${file.originalname}`, 400);
      }
    }

    return mediaFiles;
  }

  private static async markMessagesAsDelivered(conversationId: string, userId: string): Promise<void> {
    try {
      await MessageModel.updateMany(
        {
          conversationId: new Types.ObjectId(conversationId),
          senderId: { $ne: new Types.ObjectId(userId) },
          'status.delivered': { $size: 0 }
        },
        {
          $push: { 'status.delivered': new Date() }
        }
      );
    } catch (error) {
      console.error('Error marking messages as delivered:', error);
    }
  }
}