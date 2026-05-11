import express from 'express';
import * as conversationController from '../controllers/conversationController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import {
  assignConversationSchema,
  conversationParamsSchema,
  updateConversationStatusSchema,
} from '../validations/inboxValidation';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);

router.get('/', restrictTo('owner', 'admin', 'agent'), conversationController.listConversations);
router.get(
  '/:conversationId/messages',
  restrictTo('owner', 'admin', 'agent'),
  validate(conversationParamsSchema),
  conversationController.getConversationMessages
);
router.patch(
  '/:conversationId/assign',
  restrictTo('owner', 'admin'),
  validate(assignConversationSchema),
  conversationController.assignConversation
);
router.patch(
  '/:conversationId/status',
  restrictTo('owner', 'admin', 'agent'),
  validate(updateConversationStatusSchema),
  conversationController.updateConversationStatus
);

export default router;
