import express from 'express';
import { MessageController } from '../controllers/message.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

import {
    upload,
} from '../types/multerType.js';

// Apply auth middleware to all routes
router.use(authMiddleware);

// Routes - Specific routes FIRST, then parameterized routes

/**
 * @route   POST /api/v1/messages
 * @desc    Send a new message
 * @access  Private
 */
router.post('/', upload.array('files', 10), MessageController.sendMessage

/**
 * @route   GET /api/v1/messages/:conversationId/search
 * @desc    Search messages in a conversation
 * @access  Private
 */
router.get('/:conversationId/search', (MessageController.searchMessages))

/**
 * @route   GET /api/v1/messages/:conversationId/stats
 * @desc    Get message statistics for a conversation
 * @access  Private
 */
router.get('/:conversationId/stats', 
  MessageController.getMessageStats
);

/**
 * @route   GET /api/v1/messages/:conversationId
 * @desc    Get messages for a conversation
 * @access  Private
 */
router.get('/:conversationId', 
  MessageController.getMessages
);

/**
 * @route   PUT /api/v1/messages/:messageId
 * @desc    Edit a message
 * @access  Private
 */
router.put('/:messageId', 
  MessageController.editMessage
);

/**
 * @route   DELETE /api/v1/messages/:messageId
 * @desc    Delete a message
 * @access  Private
 */
router.delete('/:messageId', 
  MessageController.deleteMessage
);

/**
 * @route   POST /api/v1/messages/:messageId/reaction
 * @desc    Add/Remove reaction to a message
 * @access  Private
 */
router.post('/:messageId/reaction', 
  MessageController.toggleReaction
);

/**
 * @route   PUT /api/v1/messages/:messageId/read
 * @desc    Mark message as read
 * @access  Private
 */
router.put('/:messageId/read', 
  MessageController.markAsRead
);

/**
 * @route   POST /api/v1/messages/:messageId/forward
 * @desc    Forward a message
 * @access  Private
 */
router.post('/:messageId/forward', 
  MessageController.forwardMessage
);

export default router;