// src/config/multer.ts
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { ImageProcessor } from '../utils/imageProcessor.js';

// Multer configuration for avatar upload
const multerStorage = multer.memoryStorage();

// File filter for image uploads
const multerFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Check if file is an image
  if (!file.mimetype.startsWith('image/')) {
    return cb(new AppError('Only image files are allowed', 400));
  }

  // Check if format is supported for AVIF conversion
  if (!ImageProcessor.isSupportedFormat(file.mimetype)) {
    return cb(
      new AppError(
        `Image format '${file.mimetype}' is not supported. Supported formats: JPEG, PNG, WebP, GIF, BMP, TIFF`,
        400
      )
    );
  }

  cb(null, true);
};

// Create multer upload instance for avatars
export const uploadAvatar = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1, // Only single file
    fields: 10 // Limit form fields
  }
});

// Error handler for multer errors
export const handleMulterError = (error: Error, _req: Request, _res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Image size too large. Maximum size allowed is 5MB', 400));
    }
    
    if (error.code === 'LIMIT_FILE_COUNT') {
      return next(new AppError('Too many files. Only one image is allowed', 400));
    }
    
    if (error.code === 'LIMIT_FIELD_COUNT') {
      return next(new AppError('Too many form fields', 400));
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError('Unexpected file field', 400));
    }
    
    return next(new AppError(`Upload error: ${error.message}`, 400));
  }
  
  next(error);
};

// Middleware to validate uploaded file
export const validateUploadedFile = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (!req.file) {
    return next(new AppError('Please select an image to upload', 400));
  }

  try {
    // Additional validation using ImageProcessor
    ImageProcessor.validateImage(req.file);
    next();
  } catch (error) {
    next(error);
  }
};