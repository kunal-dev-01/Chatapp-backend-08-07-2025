import { AppError } from '@/utils/AppError';
import { NextFunction } from 'express';
import multer from 'multer';

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
}

export interface AuthenticatedRequest extends Omit<Request, 'files'> {
  files?: MulterFile[];
  user?: {
    userId: string;
    email: string;
  };
}

const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
    files: 10 // Max 10 files per request
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
      // Videos
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
      // Documents
      'application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'application/zip'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(`File type ${file.mimetype} not supported`, 400));
    }
  }
});

