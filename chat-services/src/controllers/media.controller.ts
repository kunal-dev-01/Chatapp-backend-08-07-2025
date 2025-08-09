// services/chat-service/src/controllers/media.controller.ts
import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { ConversationModel } from '../models/conversation.model.js';
import { MessageModel } from '../models/message.model.js';
import { MediaUploadService } from '../utils/mediaUploadService.js';
import { MediaProcessor } from '../utils/mediaProcessor.js';
import { AppError } from '../utils/AppError.js';
import { MulterFile } from '../types/multerType.js';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export class MediaController {
  /**
   * Upload media files
   */
  public static async uploadFiles(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id as string;
      const files = req.files as MulterFile[];

      if (!files || files.length === 0) {
        return next(new AppError('No files provided', 400));
      }

      // Verify conversation exists and user is participant
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('You are not a participant in this conversation', 403));
      }

      const uploadResults = [];

      // Process each file
      for (const file of files) {
        try {
          let uploadResult;

          if (file.mimetype.startsWith('image/')) {
            MediaProcessor.validateMediaFile(file, 'image');
            uploadResult = await MediaUploadService.uploadImage(file, conversationId as string, userId);
          } else if (file.mimetype.startsWith('video/')) {
            MediaProcessor.validateMediaFile(file, 'video');
            uploadResult = await MediaUploadService.uploadVideo(file, conversationId as string, userId);
          } else {
            MediaProcessor.validateMediaFile(file, 'document');
            uploadResult = await MediaUploadService.uploadDocument(file, conversationId as string, userId);
          }

          uploadResults.push({
            originalName: file.originalname,
            fileName: uploadResult.key,
            mimeType: file.mimetype,
            size: uploadResult.size,
            url: uploadResult.url,
            thumbnailUrl: uploadResult.thumbnailUrl,
            metadata: uploadResult.metadata,
            uploadedAt: new Date()
          });

        } catch (error) {
          console.error(`Error processing file ${file.originalname}:`, error);
          // Continue with other files, but note the error
          uploadResults.push({
            originalName: file.originalname,
            error: error instanceof Error ? error.message : 'Upload failed'
          });
        }
      }

      // Filter successful uploads
      const successfulUploads = uploadResults.filter(result => !result.error);
      const failedUploads = uploadResults.filter(result => result.error);

      res.status(201).json({
        success: true,
        message: `${successfulUploads.length} files uploaded successfully`,
        data: {
          uploads: successfulUploads,
          failures: failedUploads.length > 0 ? failedUploads : undefined,
          totalFiles: files.length,
          successCount: successfulUploads.length,
          failureCount: failedUploads.length
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get media files in a conversation
   */
  public static async getMediaFiles(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id;
      const { type, page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

      // Verify conversation access
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied', 403));
      }

      // Build query
      const query: any = {
        conversationId,
        isDeleted: false,
        deletedFor: { $ne: new Types.ObjectId(userId) },
        mediaFiles: { $exists: true, $not: { $size: 0 } }
      };

      if (type) {
        query.messageType = type;
      }

      // Get messages with media files
      const messages = await MessageModel.find(query)
        .populate('senderId', 'name avatar email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit as string))
        .lean();

      // Extract media files with message context
      const mediaFiles = [];
      for (const message of messages) {
        if (message.mediaFiles && message.mediaFiles.length > 0) {
          for (const mediaFile of message.mediaFiles) {
            mediaFiles.push({
              ...mediaFile,
              messageId: message._id,
              senderId: message.senderId,
              sentAt: message.createdAt
            });
          }
        }
      }

      // Get total count
      const totalMessages = await MessageModel.countDocuments(query);

      res.json({
        success: true,
        data: {
          mediaFiles,
          pagination: {
            currentPage: parseInt(page as string),
            totalPages: Math.ceil(totalMessages / parseInt(limit as string)),
            totalFiles: mediaFiles.length,
            hasNextPage: parseInt(page as string) < Math.ceil(totalMessages / parseInt(limit as string)),
            hasPrevPage: parseInt(page as string) > 1
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a media file
   */
  public static async deleteFile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { conversationId, fileKey } = req.params;
      const userId = req.user?.id;

      // Verify conversation access
      const conversation = await ConversationModel.findById(conversationId);
      if (!conversation) {
        return next(new AppError('Conversation not found', 404));
      }

      if (!conversation.participants.includes(new Types.ObjectId(userId))) {
        return next(new AppError('Access denied', 403));
      }

      // Find message with the media file
      const message = await MessageModel.findOne({
        conversationId,
        'mediaFiles.fileName': fileKey,
        isDeleted: false
      });

      if (!message) {
        return next(new AppError('Media file not found', 404));
      }

      // Only sender can delete media file
      if (message.senderId.toString() !== userId) {
        return next(new AppError('You can only delete your own media files', 403));
      }

      // Find the specific media file
      const mediaFile = message.mediaFiles?.find(file => file.fileName === fileKey);
      if (!mediaFile) {
        return next(new AppError('Media file not found in message', 404));
      }

      // Delete from S3
      await MediaUploadService.deleteMediaFiles(mediaFile);

      // Remove from message
      message.mediaFiles = message.mediaFiles?.filter(file => file.fileName !== fileKey);
      
      // If no media files left and it's not a text message, mark as deleted
      if (message.mediaFiles?.length === 0 && message.messageType !== 'text') {
        message.isDeleted = true;
        message.content = undefined;
      }

      await message.save();

      // Send real-time update
      const wsManager = req.app.locals.wsManager;
      if (wsManager) {
        await wsManager.broadcastToConversation(conversationId, {
          type: 'MEDIA_FILE_DELETED',
          data: {
            messageId: message._id,
            fileKey,
            deletedBy: userId
          },
          timestamp: Date.now()
        });
      }

      res.json({
        success: true,
        message: 'Media file deleted successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get supported file formats
   */
  public static async getSupportedFormats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const formats = MediaProcessor.getSupportedFormats();

      res.json({
        success: true,
        data: formats
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Get upload limits
   */
  public static async getUploadLimits(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limits = MediaUploadService.getUploadLimits();

      res.json({
        success: true,
        data: limits
      });

    } catch (error) {
      next(error);
    }
  }
}