import express from 'express';
import * as messageController from '../controllers/messageController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import { messageParamsSchema, sendTemplateMessageSchema } from '../validations/messageValidation';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);

// Route matches the Blueprint specification exactly
router.post(
  '/template-send',
  restrictTo('owner', 'admin', 'agent'),
  validate(sendTemplateMessageSchema),
  messageController.sendTemplateMessage
);
router.get('/:messageId', validate(messageParamsSchema), messageController.getMessage);

export default router;
