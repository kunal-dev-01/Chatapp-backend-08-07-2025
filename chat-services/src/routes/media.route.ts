// services/chat-service/src/routes/media.routes.ts
import express from 'express';
import { MediaController } from '../controllers/media.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

import {
 upload,
} from '../types/multerType.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// IMPORTANT: Specific routes MUST come before parameterized routes

/**
 * @route GET /api/v1/media/info/formats
 * @desc Get supported file formats and limits
 * @access Private
 */
router.get('/info/formats', MediaController.getSupportedFormats);

/**
 * @route GET /api/v1/media/info/limits
 * @desc Get upload limits
 * @access Private
 */
router.get('/info/limits', MediaController.getUploadLimits);

/**
 * @route POST /api/v1/media/:conversationId/upload
 * @desc Upload media files
 * @access Private
 */
router.post('/:conversationId/upload',
  upload.array('files', 10),
  MediaController.uploadFiles
);

/**
 * @route GET /api/v1/media/:conversationId
 * @desc Get media files in conversation
 * @access Private
 */
router.get('/:conversationId',
  MediaController.getMediaFiles
);

/**
 * @route DELETE /api/v1/media/:conversationId/:fileKey
 * @desc Delete media file
 * @access Private
 */
router.delete('/:conversationId/:fileKey',
  MediaController.deleteFile
);

export default router;