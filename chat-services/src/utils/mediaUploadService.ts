// services/chat-service/src/utils/mediaUploadService.ts
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, s3Config, generateCloudFrontUrl } from "../config/aws.js";
import { MediaProcessor } from "./mediaProcessor.js";
import { AppError } from "./AppError.js";
import { IMediaFile } from "../models/message.model.js";
import { MulterFile } from "../types/multerType.js";

export interface UploadResult {
  url: string;
  thumbnailUrl?: string;
  key: string;
  thumbnailKey?: string;
  size: number;
  metadata: {
    width?: number;
    height?: number;
    duration?: number;
    format: string;
  };
}

export class MediaUploadService {
  /**
   * Upload image with optimization
   */
  public static async uploadImage(
    file: MulterFile,
    conversationId: string,
    userId: string
  ): Promise<UploadResult> {
    try {
      const processedImage = await MediaProcessor.processImage(file);

      const key = this.generateImageKey(
        conversationId,
        userId,
        processedImage.format
      );

      const uploadCommand = new PutObjectCommand({
        Bucket: s3Config.bucketName,
        Key: key,
        Body: processedImage.buffer,
        ContentType: `image/${processedImage.format}`,
        CacheControl: "max-age=31536000",
        Metadata: {
          conversationId,
          userId,
          originalFormat: file.mimetype,
          processedAt: new Date().toISOString(),
          width: processedImage.width.toString(),
          height: processedImage.height.toString(),
        },
      });

      await s3Client.send(uploadCommand);

      return {
        url: generateCloudFrontUrl(key),
        key,
        size: processedImage.size,
        metadata: {
          width: processedImage.width,
          height: processedImage.height,
          format: processedImage.format,
        },
      };
    } catch (error) {
      console.error("Image upload error:", error);
      throw new AppError("Failed to upload image", 500);
    }
  }

  /**
   * Upload video with compression and thumbnail generation
   */
  public static async uploadVideo(
    file: MulterFile,
    conversationId: string,
    userId: string
  ): Promise<UploadResult> {
    try {
      const processedVideo = await MediaProcessor.processVideo(file);

      const videoKey = this.generateVideoKey(conversationId, userId);
      const thumbnailKey = this.generateThumbnailKey(conversationId, userId);

      // Upload compressed video
      const videoUploadCommand = new PutObjectCommand({
        Bucket: s3Config.bucketName,
        Key: videoKey,
        Body: processedVideo.videoBuffer,
        ContentType: "video/mp4",
        CacheControl: "max-age=31536000",
        Metadata: {
          conversationId,
          userId,
          originalFormat: file.mimetype,
          processedAt: new Date().toISOString(),
          duration: processedVideo.duration.toString(),
          width: processedVideo.width.toString(),
          height: processedVideo.height.toString(),
        },
      });

      // Upload thumbnail
      const thumbnailUploadCommand = new PutObjectCommand({
        Bucket: s3Config.bucketName,
        Key: thumbnailKey,
        Body: processedVideo.thumbnailBuffer,
        ContentType: "image/webp",
        CacheControl: "max-age=31536000",
        Metadata: {
          conversationId,
          userId,
          type: "video-thumbnail",
          processedAt: new Date().toISOString(),
        },
      });

      await Promise.all([
        s3Client.send(videoUploadCommand),
        s3Client.send(thumbnailUploadCommand),
      ]);

      return {
        url: generateCloudFrontUrl(videoKey),
        thumbnailUrl: generateCloudFrontUrl(thumbnailKey),
        key: videoKey,
        thumbnailKey,
        size: processedVideo.size,
        metadata: {
          width: processedVideo.width,
          height: processedVideo.height,
          duration: processedVideo.duration,
          format: "mp4",
        },
      };
    } catch (error) {
      console.error("Video upload error:", error);
      throw new AppError("Failed to upload video", 500);
    }
  }

  /**
   * Upload document/file
   */
  public static async uploadDocument(
    file: MulterFile,
    conversationId: string,
    userId: string
  ): Promise<UploadResult> {
    try {
      // Validate file type and size
      this.validateDocument(file);

      const key = this.generateDocumentKey(
        conversationId,
        userId,
        file.originalname
      );

      const uploadCommand = new PutObjectCommand({
        Bucket: s3Config.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentDisposition: `attachment; filename="${file.originalname}"`,
        CacheControl: "max-age=31536000",
        Metadata: {
          conversationId,
          userId,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      });

      await s3Client.send(uploadCommand);

      return {
        url: generateCloudFrontUrl(key),
        key,
        size: file.size,
        metadata: {
          format: file.mimetype,
        },
      };
    } catch (error) {
      console.error("Document upload error:", error);
      throw new AppError("Failed to upload document", 500);
    }
  }

  public static async uploadAudio(
    file: MulterFile,
    conversationId: string,
    userId: string
  ): Promise<UploadResult> {
    try {
      const processedAudio = await MediaProcessor.processAudio(file);

      const key = this.generateAudioKey(
        conversationId,
        userId,
        processedAudio.format
      );

      const uploadCommand = new PutObjectCommand({
        Bucket: s3Config.bucketName,
        Key: key,
        Body: processedAudio.audioBuffer,
        ContentType: `audio/${processedAudio.format}`,
        CacheControl: "max-age=31536000",
        Metadata: {
          conversationId,
          userId,
          originalFormat: file.mimetype,
          processedAt: new Date().toISOString(),
          duration: processedAudio.duration.toString(),
          bitrate: processedAudio.bitrate?.toString() || "",
        },
      });

      await s3Client.send(uploadCommand);

      return {
        url: generateCloudFrontUrl(key),
        key,
        size: processedAudio.size,
        metadata: {
          duration: processedAudio.duration,
          format: processedAudio.format,
        },
      };
    } catch (error) {
      console.error("Audio upload error:", error);
      throw new AppError("Failed to upload audio", 500);
    }
  }

  private static generateAudioKey(
    conversationId: string,
    userId: string,
    format: string
  ): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `chat/audio/${conversationId}/${userId}/${timestamp}-${random}.${format}`;
  }

  /**
   * Delete media files from S3
   */
  public static async deleteMediaFiles(mediaFile: IMediaFile): Promise<void> {
    try {
      const deletePromises: Promise<any>[] = [];

      // Delete main file
      if (mediaFile.fileName) {
        const mainKey = this.extractKeyFromUrl(mediaFile.url);
        if (mainKey) {
          deletePromises.push(this.deleteFile(mainKey));
        }
      }

      // Delete thumbnail if exists
      if (mediaFile.thumbnailUrl) {
        const thumbnailKey = this.extractKeyFromUrl(mediaFile.thumbnailUrl);
        if (thumbnailKey) {
          deletePromises.push(this.deleteFile(thumbnailKey));
        }
      }

      await Promise.all(deletePromises);
    } catch (error) {
      console.error("Media deletion error:", error);
      // Don't throw error to avoid breaking main flow
    }
  }

  /**
   * Generate unique keys for different file types
   */
  private static generateImageKey(
    conversationId: string,
    userId: string,
    format: string
  ): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `chat/images/${conversationId}/${userId}/${timestamp}-${random}.${format}`;
  }

  private static generateVideoKey(
    conversationId: string,
    userId: string
  ): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `chat/videos/${conversationId}/${userId}/${timestamp}-${random}.mp4`;
  }

  private static generateThumbnailKey(
    conversationId: string,
    userId: string
  ): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `chat/thumbnails/${conversationId}/${userId}/${timestamp}-${random}.webp`;
  }

  private static generateDocumentKey(
    conversationId: string,
    userId: string,
    originalName: string
  ): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const extension = originalName.split(".").pop();
    const baseName = originalName
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9]/g, "-");
    return `chat/documents/${conversationId}/${userId}/${timestamp}-${random}-${baseName}.${extension}`;
  }

  /**
   * Validate document files
   */
  private static validateDocument(file: MulterFile): void {
    const maxSize = 50 * 1024 * 1024; // 50MB
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "application/zip",
      "application/x-rar-compressed",
    ];

    if (file.size > maxSize) {
      throw new AppError("Document size cannot exceed 50MB", 400);
    }

    if (!allowedTypes.includes(file.mimetype)) {
      throw new AppError("Invalid document type", 400);
    }
  }

  /**
   * Helper methods
   */
  private static async deleteFile(key: string): Promise<void> {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
    });
    await s3Client.send(deleteCommand);
  }

  private static extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.substring(1);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get upload limits for different file types
   */
  public static getUploadLimits() {
  return {
    image: {
      maxSize: 10 * 1024 * 1024, // 10MB
      formats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    },
    video: {
      maxSize: 100 * 1024 * 1024, // 100MB
      formats: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm']
    },
    audio: {
      maxSize: 25 * 1024 * 1024, // 25MB
      formats: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/x-m4a', 'audio/mp4']
    },
    document: {
      maxSize: 50 * 1024 * 1024, // 50MB
      formats: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      ]
    }
  };
}
}
