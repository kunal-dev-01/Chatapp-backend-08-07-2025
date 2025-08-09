// src/routes/follow.routes.ts
import { Router } from 'express';
import {
  followUser,
  unfollowUser,
  acceptFollowRequest,
  rejectFollowRequest,
  cancelFollowRequest,
  getFollowers,
  getFollowing,
  getFollowRequests,
  getSentRequests,
  blockUser,
  unblockUser,
  getBlockedUsers,
  removeFollower
} from '../controllers/social.controller.js';

import { tokenRefreshMiddleware } from '../middlewares/tokenRefresh.middleware.js';

const router = Router();

router.use(tokenRefreshMiddleware)

router.post('/follow/:userId', followUser);
router.delete('/unfollow/:userId', unfollowUser);

router.post('/requests/accept/:requesterId', acceptFollowRequest);
router.post('/requests/reject/:requesterId', rejectFollowRequest);
router.delete('/requests/cancel/:userId', cancelFollowRequest);

// Block system routes
router.post('/block/:userId', blockUser);
router.delete('/unblock/:userId', unblockUser);
router.get('/blocked', getBlockedUsers);

// Remove follower (useful when someone you don't want following you)
router.delete('/remove-follower/:userId', removeFollower);

router.get('/requests', getFollowRequests);
router.get('/requests/sent', getSentRequests);

// Fixed routes - separate endpoints for with/without userId
router.get('/followers', getFollowers);
router.get('/followers/:userId',  getFollowers);
router.get('/following',  getFollowing);
router.get('/following/:userId', getFollowing);


export default router;