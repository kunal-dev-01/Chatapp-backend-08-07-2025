// services/chat-service/src/controllers/message.controller.ts
import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { MessageModel } from '../models/message.model.js';
import { ConversationModel } from '../models/conversation.model.js';
import { MediaUploadService } from '../utils/mediaUploadService.js';
import { MediaProcessor } from '../utils/mediaProcessor.js';
import { RedisService } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';
import { MulterFile } from '../types/multerType.js';

// Fixed interface - extends Request and overrides files property
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

// Type for media file response
interface ProcessedMediaFile {
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string | undefined;
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
  };
  uploadedAt: Date;
}

export class MessageController {
  /**
   * Send a new message
   */
  public static async sendMessage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {

      const { conversationId, content, messageType, replyTo } = req.body;
      const senderId = req.user?.id as string;
      const files = req.files as MulterFile[];

      // Verify conversation exists and user is participant
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(senderId))) {
        return next(new AppError('You are not a participant in this conversation', 403));
      }

      // Handle media uploads if files are present
      let mediaFiles: ProcessedMediaFile[] = [];
      if (files && files.length > 0) {
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

      // Create message
      const newMessage = new MessageModel({
        conversationId: new Types.ObjectId(conversationId),
        senderId: new Types.ObjectId(senderId),
        messageType: messageType || 'text',
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
      await ConversationModel.findByIdAndUpdate(conversationId, {
        lastMessage: savedMessage._id,
        lastActivity: new Date(),
        $inc: { 
          'metadata.totalMessages': 1,
          ...(messageType === 'image' || messageType === 'video' ? { 'metadata.mediaCount': 1 } : {}),
          ...(messageType === 'document' ? { 'metadata.fileCount': 1 } : {})
        }
      });

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
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const skip = (page - 1) * limit;

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
      .limit(limit)
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
      await MessageController.markMessagesAsDelivered(conversationId as string, userId);

      res.json({
        success: true,
        data: {
          messages: messages.reverse(), // Reverse to show oldest first
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalMessages / limit),
            totalMessages,
            hasNextPage: page < Math.ceil(totalMessages / limit),
            hasPrevPage: page > 1
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
      const { content } = req.body;
      const userId = req.user?.id;

      if(!content) {
        return next(new AppError('Message content is required', 400));
      }

      if(content.trim().length === 0) {
        return next(new AppError('Message content cannot be empty', 400));
      }

      if(content.length > 1000) {
        return next(new AppError('Message content cannot be longer than 1000 characters', 400));
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
      await RedisService.cacheMessage(messageId as string, message.toObject());

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
      const { deleteFor } = req.body; // 'me' or 'everyone'
      const userId = req.user?.id;

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
        message.mediaFiles = [];

        // Delete media files from S3
        if (message.mediaFiles && message.mediaFiles.length > 0) {
          for (const mediaFile of message.mediaFiles) {
            await MediaUploadService.deleteMediaFiles(mediaFile);
          }
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
      const { emoji } = req.body;
      const userId = new Types.ObjectId(req.user?.id);

      if (!emoji) {
        return next(new AppError('Emoji is required', 400));
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
      let reactionIndex = message.reactions.findIndex(r => r.emoji === emoji);
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
        const reaction = message.reactions[reactionIndex] as { emoji: string; users: Types.ObjectId[]; count: number; };
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

      const message = await MessageModel.findById(messageId);
      if (!message) {
        return next(new AppError('Message not found', 404));
      }

      // Don't mark own messages as read
      if (message.senderId.toString() === userId) {
        res.json({
          success: true,
          message: 'Cannot mark own message as read'
        });
        return;
      }

      // Add read timestamp if not already read
      const readTime = new Date();
      if (!message.status.read.some(readDate => 
        readDate.getTime() === readTime.getTime()
      )) {
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
      const { conversationIds } = req.body;
      const userId = req.user?.id;

      if (!conversationIds || !conversationIds.length) {
        return next(new AppError('Conversation IDs are required', 400));
      }

      const originalMessage = await MessageModel.findById(messageId);
      if (!originalMessage) {
        return next(new AppError('Message not found', 404));
      }

      if (originalMessage.isDeleted) {
        return next(new AppError('Cannot forward deleted message', 400));
      }

      const forwardedMessages = [];

      // Forward to each conversation
      for (const conversationId of conversationIds) {
        const conversation = await ConversationModel.findById(conversationId);
        if (!conversation) continue;

        if (!conversation.participants.includes(new Types.ObjectId(userId))) {
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
      const { query, messageType, dateFrom, dateTo } = req.query;
      const userId = req.user?.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

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

      if (query) {
        searchCriteria.content = { $regex: query, $options: 'i' };
      }

      if (messageType) {
        searchCriteria.messageType = messageType;
      }

      if (dateFrom || dateTo) {
        searchCriteria.createdAt = {};
        if (dateFrom) (searchCriteria.createdAt as Record<string, unknown>).$gte = new Date(dateFrom as string);
        if (dateTo) (searchCriteria.createdAt as Record<string, unknown>).$lte = new Date(dateTo as string);
      }

      const messages = await MessageModel.find(searchCriteria)
        .populate('senderId', 'name avatar email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const totalResults = await MessageModel.countDocuments(searchCriteria);

      res.json({
        success: true,
        data: {
          messages,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalResults / limit),
            totalResults,
            hasNextPage: page < Math.ceil(totalResults / limit),
            hasPrevPage: page > 1
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

      res.json({
        success: true,
        data: stats[0] || {
          totalMessages: 0,
          textMessages: 0,
          imageMessages: 0,
          videoMessages: 0,
          documentMessages: 0,
          audioMessages: 0
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Private helper methods
   */
  private static async processMediaFiles(files: MulterFile[], conversationId: string, userId: string): Promise<ProcessedMediaFile[]> {
    const mediaFiles: ProcessedMediaFile[] = [];

    for (const file of files) {
      try {
        let uploadResult;

        if (file.mimetype.startsWith('image/')) {
          MediaProcessor.validateMediaFile(file, 'image');
          uploadResult = await MediaUploadService.uploadImage(file, conversationId, userId);
        } else if (file.mimetype.startsWith('video/')) {
          MediaProcessor.validateMediaFile(file, 'video');
          uploadResult = await MediaUploadService.uploadVideo(file, conversationId, userId);
        } else {
          MediaProcessor.validateMediaFile(file, 'document');
          uploadResult = await MediaUploadService.uploadDocument(file, conversationId, userId);
        }

        mediaFiles.push({
          originalName: file.originalname,
          fileName: uploadResult.key,
          mimeType: file.mimetype,
          size: uploadResult.size,
          url: uploadResult.url,
          thumbnailUrl: uploadResult.thumbnailUrl,
          metadata: uploadResult.metadata,
          uploadedAt: new Date()
        }) ;

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
          conversationId,
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