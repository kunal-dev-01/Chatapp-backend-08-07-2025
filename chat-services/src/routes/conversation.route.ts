// services/chat-service/src/routes/conversation.routes.ts
import express from 'express';
import { ConversationController } from '../controllers/conversation.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Routes - Specific routes first, then parameterized routes

/**
 * @route   POST /api/v1/conversations
 * @desc    Create a new conversation
 * @access  Private
 */
router.post('/',  
  ConversationController.createConversation
);

/**
 * @route   GET /api/v1/conversations
 * @desc    Get user's conversations
 * @access  Private
 */
router.get('/', 
  ConversationController.getUserConversations
);

/**
 * @route   GET /api/v1/conversations/:conversationId/typing
 * @desc    Get typing users in conversation
 * @access  Private
 */
router.get('/:conversationId/typing', 
  ConversationController.getTypingUsers
);

/**
 * @route   POST /api/v1/conversations/:conversationId/participants
 * @desc    Add participants to group conversation
 * @access  Private
 */
router.post('/:conversationId/participants', 
  ConversationController.addParticipants
);

/**
 * @route   DELETE /api/v1/conversations/:conversationId/participants/:participantId
 * @desc    Remove participant from group conversation
 * @access  Private
 */
router.delete('/:conversationId/participants/:participantId', 
  ConversationController.removeParticipant
);

/**
 * @route   PUT /api/v1/conversations/:conversationId/archive
 * @desc    Archive/Unarchive conversation
 * @access  Private
 */
router.put('/:conversationId/archive', 
  ConversationController.toggleArchive
);

/**
 * @route   PUT /api/v1/conversations/:conversationId/mute
 * @desc    Mute/Unmute conversation
 * @access  Private
 */
router.put('/:conversationId/mute', 
  ConversationController.toggleMute
);

/**
 * @route   PUT /api/v1/conversations/:conversationId/pin
 * @desc    Pin/Unpin conversation
 * @access  Private
 */
router.put('/:conversationId/pin', 
  ConversationController.togglePin
);

/**
 * @route   GET /api/v1/conversations/:conversationId
 * @desc    Get conversation details
 * @access  Private
 */
router.get('/:conversationId', 
  ConversationController.getConversationDetails
);

/**
 * @route   PUT /api/v1/conversations/:conversationId
 * @desc    Update conversation (group only)
 * @access  Private
 */
router.put('/:conversationId', 
  ConversationController.updateConversation
);

/**
 * @route   DELETE /api/v1/conversations/:conversationId
 * @desc    Delete conversation
 * @access  Private
 */
router.delete('/:conversationId', 
  ConversationController.deleteConversation
);

export default router;