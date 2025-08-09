// src/routes/user.routes.ts
import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  uploadAvatar,
  removeAvatar,
  completeOnboarding,
  getSuggestedUsers,
  updatePrivacySettings,
  updateNotificationSettings,
  searchUsers,
  getUserByUsername
} from '../controllers/user.controller.js';
import { tokenRefreshMiddleware } from '../middlewares/tokenRefresh.middleware.js';
import { uploadAvatar as multerUpload, handleMulterError, validateUploadedFile } from '../config/multer';

const router = Router();


// All user routes require authentication
router.use(tokenRefreshMiddleware);

// Profile routes
router.get('/profile', getProfile);
router.patch('/profile', updateProfile);

// Avatar routes
router.post('/avatar', 
  multerUpload.single('avatar'), 
  handleMulterError, 
  validateUploadedFile, 
  uploadAvatar
);
router.delete('/avatar', removeAvatar);

// Onboarding route
router.post('/onboarding', 
  multerUpload.single('avatar'), 
  handleMulterError,
  completeOnboarding
);

// Suggested users for onboarding
router.get('/suggested', getSuggestedUsers);

// Settings routes
router.patch('/privacy', updatePrivacySettings);
router.patch('/notifications', updateNotificationSettings);

// Search and discovery
router.get('/search', searchUsers);
router.get('/:username', getUserByUsername);

export default router;