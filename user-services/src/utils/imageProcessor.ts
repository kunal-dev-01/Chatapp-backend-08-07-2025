// src/utils/imageProcessor.ts
import sharp from 'sharp';
import { AppError } from './AppError.js';
import { MulterFile } from '../types/multerType.js';

export interface ProcessedImage {
  buffer: Buffer;
  format: string;
  size: number;
  width: number;
  height: number;
}

export class ImageProcessor {
  private static readonly SUPPORTED_FORMATS = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff',
  ];

  private static readonly MAX_SIZE = 5 * 1024 * 1024; // 5MB
  private static readonly AVATAR_SIZE = 400; // 400x400
  private static readonly QUALITY = 80;

  public static isSupportedFormat(mimetype: string): boolean {
    return this.SUPPORTED_FORMATS.includes(mimetype.toLowerCase());
  }

  public static validateImage(file: MulterFile): void {
    if (file.size > this.MAX_SIZE) {
      throw new AppError(
        `Image size too large. Maximum allowed size is ${this.MAX_SIZE / (1024 * 1024)}MB`,
        400
      );
    }

    if (!this.isSupportedFormat(file.mimetype)) {
      throw new AppError(
        `Unsupported image format. Supported formats: ${this.SUPPORTED_FORMATS.join(', ')}`,
        400
      );
    }
  }

  public static async processAvatar(file: MulterFile): Promise<ProcessedImage> {
    try {
      this.validateImage(file);

      const processedBuffer = await sharp(file.buffer)
        .resize(this.AVATAR_SIZE, this.AVATAR_SIZE, {
          fit: 'cover',
          position: 'center',
        })
        .avif({
          quality: this.QUALITY,
          effort: 4,
        })
        .toBuffer();

      const metadata = await sharp(processedBuffer).metadata();

      return {
        buffer: processedBuffer,
        format: 'avif',
        size: processedBuffer.length,
        width: metadata.width ?? this.AVATAR_SIZE,
        height: metadata.height ?? this.AVATAR_SIZE,
      };
    } catch (error) {
      // 👇 No 'any' or 'unknown'
      if (
        error instanceof Error &&
        error.message.includes('Input file contains unsupported image format')
      ) {
        throw new AppError(
          'Image format not supported for AVIF conversion. Please use JPEG, PNG, WebP, GIF, BMP, or TIFF.',
          400
        );
      }

      if (
        error instanceof Error &&
        error.message.includes('Input file is corrupt')
      ) {
        throw new AppError('Image file is corrupted or invalid.', 400);
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('Failed to process image. Please try with a different image.', 500);
    }
  }

  public static generateAvatarFilename(userId: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    return `avatars/${userId}-${timestamp}-${randomString}.avif`;
  }

  public static async getImageInfo(buffer: Buffer): Promise<{
    width: number;
    height: number;
    format: string;
    size: number;
  }> {
    try {
      const metadata = await sharp(buffer).metadata();

      return {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        format: metadata.format ?? 'unknown',
        size: buffer.length,
      };
    } catch (err) {
      throw new AppError('Failed to read image metadata', 400);
    }
  }

  public static async canConvertToAvif(buffer: Buffer): Promise<boolean> {
    try {
      await sharp(buffer).avif().toBuffer();
      return true;
    } catch {
      return false;
    }
  }
}
