// src/utils/s3Upload.ts
import {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import {
  s3Client,
  cloudFrontClient,
  s3Config,
  cloudFrontConfig,
  generateCloudFrontUrl,
} from "../config/aws.js";
import { ImageProcessor, ProcessedImage } from "./imageProcessor.js";
import { AppError } from "./AppError.js";
import { MulterFile } from "../types/multerType.js";
export interface UploadResult {
  cloudFrontUrl: string;
  key: string;
  size: number;
  format: string;
}

function isError(err: unknown): err is Error & { name?: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

export class S3UploadService {
  /**
   * Upload processed avatar to S3
   */
  public static async uploadAvatar(
    userId: string,
    file: MulterFile,
    oldAvatarKey?: string
  ): Promise<UploadResult> {
    try {
      // Process image to AVIF
      const processedImage: ProcessedImage = await ImageProcessor.processAvatar(
        file
      );

      // Generate unique filename
      const key = ImageProcessor.generateAvatarFilename(userId);

      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: s3Config.bucketName,
        Key: key,
        Body: processedImage.buffer,
        ContentType: "image/avif",
        CacheControl: "max-age=31536000", // 1 year cache
        Metadata: {
          userId: userId,
          originalFormat: file.mimetype,
          processedAt: new Date().toISOString(),
          width: processedImage.width.toString(),
          height: processedImage.height.toString(),
        },
      });

      await s3Client.send(uploadCommand);

      // Delete old avatar if exists
      if (oldAvatarKey) {
        await this.deleteFile(oldAvatarKey);
      }

      // Generate CloudFront URL
      const cloudFrontUrl = generateCloudFrontUrl(key);

      return {
        cloudFrontUrl,
        key,
        size: processedImage.size,
        format: processedImage.format,
      };
    } catch (error) {
      if (isError(error)) {
        if (error instanceof AppError) {
          throw error;
        }

        console.error("S3 Upload Error:", error.message);
        throw new AppError("Failed to upload avatar. Please try again.", 500);
      }

      throw new AppError("Unknown error occurred during upload.", 500);
    }
  }

  /**
   * Delete file from S3
   */
  public static async deleteFile(key: string): Promise<void> {
    try {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: s3Config.bucketName,
        Key: key,
      });

      await s3Client.send(deleteCommand);

      // Invalidate CloudFront cache
      await this.invalidateCloudFrontCache([key]);
    } catch (error: any) {
      console.error("S3 Delete Error:", error);
      // Don't throw error for delete operations to avoid breaking the main flow
    }
  }

  /**
   * Check if file exists in S3
   */
  public static async fileExists(key: string): Promise<boolean> {
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: s3Config.bucketName,
        Key: key,
      });

      await s3Client.send(headCommand);
      return true;
    } catch (error: any) {
      if (error.name === "NotFound") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Invalidate CloudFront cache for specific files
   */
  public static async invalidateCloudFrontCache(keys: string[]): Promise<void> {
    try {
      if (keys.length === 0) return;

      const paths = keys.map((key) => `/${key}`);

      const invalidationCommand = new CreateInvalidationCommand({
        DistributionId: cloudFrontConfig.distributionId,
        InvalidationBatch: {
          CallerReference: `invalidation-${Date.now()}`,
          Paths: {
            Quantity: paths.length,
            Items: paths,
          },
        },
      });

      await cloudFrontClient.send(invalidationCommand);
    } catch (error: any) {
      console.error("CloudFront Invalidation Error:", error);
      // Don't throw error for cache invalidation to avoid breaking the main flow
    }
  }

  /**
   * Extract S3 key from CloudFront URL
   */
  public static extractKeyFromUrl(cloudFrontUrl: string): string | null {
    try {
      const url = new URL(cloudFrontUrl);
      return url.pathname.substring(1); // Remove leading slash
    } catch (error) {
      return null;
    }
  }

  /**
   * Validate S3 connection
   */
  public static async validateConnection(): Promise<boolean> {
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: s3Config.bucketName,
        Key: "test-connection", // This doesn't need to exist
      });

      await s3Client.send(headCommand);
      return true;
    } catch (error: any) {
      // If it's a NotFound error, the connection is working
      if (error.name === "NotFound") {
        return true;
      }

      console.error("S3 Connection Error:", error);
      return false;
    }
  }

  /**
   * Get file size limits and supported formats
   */
  public static getUploadLimits() {
    return {
      maxSize: s3Config.maxFileSize,
      maxSizeMB: s3Config.maxFileSize / (1024 * 1024),
      supportedFormats: s3Config.allowedFormats,
      outputFormat: "image/avif",
    };
  }
}
