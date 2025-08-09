// services/chat-service/src/utils/mediaProcessor.ts
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from './AppError.js';
import { MulterFile } from '../types/multerType.js';

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  size: number;
  format: string;
}

export interface ProcessedVideo {
  videoBuffer: Buffer;
  thumbnailBuffer: Buffer;
  width: number;
  height: number;
  duration: number;
  size: number;
}

export class MediaProcessor {
  private static readonly TEMP_DIR = '/tmp/chat-media';
  private static readonly MAX_IMAGE_DIMENSION = 1920;
  private static readonly MAX_VIDEO_DIMENSION = 1280;
  private static readonly VIDEO_BITRATE = '1000k';
  private static readonly THUMBNAIL_SIZE = 320;

  /**
   * Process image with Sharp - optimize and resize
   */
  public static async processImage(file: MulterFile): Promise<ProcessedImage> {
    try {
      let sharpInstance = sharp(file.buffer);
      
      // Get metadata
      const metadata = await sharpInstance.metadata();
      
      // Calculate new dimensions while maintaining aspect ratio
      const { width: newWidth, height: newHeight } = this.calculateImageDimensions(
        metadata.width || 0,
        metadata.height || 0
      );

      // Process image
      const processedBuffer = await sharpInstance
        .resize(newWidth, newHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          quality: 85,
          effort: 4,
        })
        .toBuffer();

      // Get final metadata
      const finalMetadata = await sharp(processedBuffer).metadata();

      return {
        buffer: processedBuffer,
        width: finalMetadata.width || newWidth,
        height: finalMetadata.height || newHeight,
        size: processedBuffer.length,
        format: 'webp'
      };
    } catch (error) {
      console.error('Image processing error:', error);
      throw new AppError('Failed to process image', 500);
    }
  }

  /**
   * Process video with FFmpeg - compress and generate thumbnail
   */
  public static async processVideo(file: MulterFile): Promise<ProcessedVideo> {
    try {
      await this.ensureTempDir();

      const inputPath = path.join(this.TEMP_DIR, `input-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${this.getFileExtension(file.originalname)}`);
      const outputPath = path.join(this.TEMP_DIR, `output-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.mp4`);
      const thumbnailPath = path.join(this.TEMP_DIR, `thumb-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.webp`);

      // Write input file
      await fs.writeFile(inputPath, file.buffer);

      try {
        // Get video metadata
        const metadata = await this.getVideoMetadata(inputPath);
        
        // Calculate new dimensions
        const { width: newWidth, height: newHeight } = this.calculateVideoDimensions(
          metadata.width,
          metadata.height
        );

        // Process video
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .output(outputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .videoBitrate(this.VIDEO_BITRATE)
            .size(`${newWidth}x${newHeight}`)
            .format('mp4')
            .outputOptions([
              '-preset fast',
              '-crf 23',
              '-movflags +faststart'
            ])
            .on('end', resolve as () => void)
            .on('error', reject)
            .run();
        });

        // Generate thumbnail
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .screenshots({
              timestamps: ['10%'],
              filename: path.basename(thumbnailPath),
              folder: path.dirname(thumbnailPath),
              size: `${this.THUMBNAIL_SIZE}x?`
            })
            .on('end', resolve as () => void)
            .on('error', reject);
        });

        // Optimize thumbnail with Sharp
        const thumbnailBuffer = await fs.readFile(thumbnailPath);
        const optimizedThumbnail = await sharp(thumbnailBuffer)
          .webp({ quality: 80 })
          .toBuffer();

        // Read processed video
        const videoBuffer = await fs.readFile(outputPath);

        return {
          videoBuffer,
          thumbnailBuffer: optimizedThumbnail,
          width: newWidth,
          height: newHeight,
          duration: metadata.duration,
          size: videoBuffer.length
        };

      } finally {
        // Cleanup temp files
        await this.cleanupFiles([inputPath, outputPath, thumbnailPath]);
      }

    } catch (error) {
      console.error('Video processing error:', error);
      throw new AppError('Failed to process video', 500);
    }
  }

  /**
   * Generate video thumbnail only
   */
  public static async generateVideoThumbnail(file: MulterFile): Promise<Buffer> {
    try {
      await this.ensureTempDir();

      const inputPath = path.join(this.TEMP_DIR, `input-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${this.getFileExtension(file.originalname)}`);
      const thumbnailPath = path.join(this.TEMP_DIR, `thumb-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`);

      await fs.writeFile(inputPath, file.buffer);

      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .screenshots({
              timestamps: ['10%'],
              filename: path.basename(thumbnailPath),
              folder: path.dirname(thumbnailPath),
              size: `${this.THUMBNAIL_SIZE}x?`
            })
            .on('end', resolve as () => void)
            .on('error', reject);
        });

        const thumbnailBuffer = await fs.readFile(thumbnailPath);
        
        // Optimize with Sharp
        return await sharp(thumbnailBuffer)
          .webp({ quality: 80 })
          .toBuffer();

      } finally {
        await this.cleanupFiles([inputPath, thumbnailPath]);
      }

    } catch (error) {
      console.error('Thumbnail generation error:', error);
      throw new AppError('Failed to generate thumbnail', 500);
    }
  }

  /**
   * Validate media file
   */
  public static validateMediaFile(file: MulterFile, type: 'image' | 'video' | 'document'): void {
    const limits = {
      image: {
        maxSize: 10 * 1024 * 1024, // 10MB
        types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      },
      video: {
        maxSize: 100 * 1024 * 1024, // 100MB  
        types: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm']
      },
      document: {
        maxSize: 50 * 1024 * 1024, // 50MB
        types: ['application/pdf', 'application/msword', 'text/plain']
      }
    };

    const limit = limits[type];
    
    if (file.size > limit.maxSize) {
      throw new AppError(`${type} size cannot exceed ${limit.maxSize / 1024 / 1024}MB`, 400);
    }

    if (!limit.types.includes(file.mimetype)) {
      throw new AppError(`Invalid ${type} format`, 400);
    }
  }

  /**
   * Private helper methods
   */
  private static calculateImageDimensions(width: number, height: number): { width: number; height: number } {
    if (width <= this.MAX_IMAGE_DIMENSION && height <= this.MAX_IMAGE_DIMENSION) {
      return { width, height };
    }

    const aspectRatio = width / height;
    
    if (width > height) {
      return {
        width: this.MAX_IMAGE_DIMENSION,
        height: Math.round(this.MAX_IMAGE_DIMENSION / aspectRatio)
      };
    } else {
      return {
        width: Math.round(this.MAX_IMAGE_DIMENSION * aspectRatio),
        height: this.MAX_IMAGE_DIMENSION
      };
    }
  }

  private static calculateVideoDimensions(width: number, height: number): { width: number; height: number } {
    if (width <= this.MAX_VIDEO_DIMENSION && height <= this.MAX_VIDEO_DIMENSION) {
      return { width, height };
    }

    const aspectRatio = width / height;
    
    if (width > height) {
      return {
        width: this.MAX_VIDEO_DIMENSION,
        height: Math.round(this.MAX_VIDEO_DIMENSION / aspectRatio)
      };
    } else {
      return {
        width: Math.round(this.MAX_VIDEO_DIMENSION * aspectRatio),
        height: this.MAX_VIDEO_DIMENSION
      };
    }
  }

  private static async getVideoMetadata(filePath: string): Promise<{ width: number; height: number; duration: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        resolve({
          width: videoStream.width || 1280,
          height: videoStream.height || 720,
          duration: metadata.format.duration || 0
        });
      });
    });
  }

  private static async ensureTempDir(): Promise<void> {
    try {
      await fs.access(this.TEMP_DIR);
    } catch {
      await fs.mkdir(this.TEMP_DIR, { recursive: true });
    }
  }

  private static async cleanupFiles(filePaths: string[]): Promise<void> {
    await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          // Ignore cleanup errors
        }
      })
    );
  }

  private static getFileExtension(filename: string): string {
    return filename.split('.').pop() || 'tmp';
  }

  /**
   * Get supported formats and limits
   */
  public static getSupportedFormats() {
    return {
      images: {
        input: ['jpeg', 'jpg', 'png', 'webp', 'gif'],
        output: 'webp',
        maxSize: '10MB',
        maxDimension: this.MAX_IMAGE_DIMENSION
      },
      videos: {
        input: ['mp4', 'mov', 'avi', 'webm'],
        output: 'mp4',
        maxSize: '100MB',
        maxDimension: this.MAX_VIDEO_DIMENSION,
        thumbnailFormat: 'webp'
      }
    };
  }
}