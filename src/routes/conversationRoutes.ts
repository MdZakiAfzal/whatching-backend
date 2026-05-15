import express from 'express';
import * as conversationController from '../controllers/conversationController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import {
  assignConversationSchema,
  conversationParamsSchema,
  markConversationReadSchema,
  replyToConversationSchema,
  updateConversationStatusSchema,
} from '../validations/inboxValidation';
import * as messageController from '../controllers/messageController';

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
router.get(
  '/:conversationId',
  restrictTo('owner', 'admin', 'agent'),
  validate(conversationParamsSchema),
  conversationController.getConversation
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
router.patch(
  '/:conversationId/read',
  restrictTo('owner', 'admin', 'agent'),
  validate(markConversationReadSchema),
  conversationController.markConversationRead
);
router.post(
  '/:conversationId/reply',
  restrictTo('owner', 'admin', 'agent'),
  validate(replyToConversationSchema),
  messageController.sendTextReply
);

export default router;
