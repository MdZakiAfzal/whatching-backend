import express from 'express';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import * as chatController from '../controllers/chatController';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);

router.get('/bootstrap', restrictTo('owner', 'admin', 'agent'), chatController.getChatBootstrap);

export default router;
