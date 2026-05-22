import express from 'express';
import * as subscriberController from '../controllers/subscriberController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import {
  importSubscribersSchema,
  subscriberParamsSchema,
  updateSubscriberSchema,
  bulkDeleteSubscribersSchema,
  // 👉 Make sure to update your validation file to export these two new schemas!
  attachTagsSchema, 
  detachTagSchema
} from '../validations/inboxValidation';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);

router.post(
  '/import',
  restrictTo('owner', 'admin'),
  validate(importSubscribersSchema),
  subscriberController.importSubscribers
);

router.post(
  '/bulk-delete',
  restrictTo('owner', 'admin'),
  validate(bulkDeleteSubscribersSchema),
  subscriberController.bulkDeleteSubscribers
);

router.get('/', restrictTo('owner', 'admin', 'agent'), subscriberController.listSubscribers);

router.get(
  '/:subscriberId',
  restrictTo('owner', 'admin', 'agent'),
  validate(subscriberParamsSchema),
  subscriberController.getSubscriber
);

router.patch(
  '/:subscriberId',
  restrictTo('owner', 'admin', 'agent'),
  validate(updateSubscriberSchema),
  subscriberController.updateSubscriber
);

// 👉 NEW: Dedicated Tagging Engine Routes
router.post(
  '/:subscriberId/tags',
  restrictTo('owner', 'admin', 'agent'),
  validate(attachTagsSchema),
  subscriberController.attachTagsToSubscriber
);

router.delete(
  '/:subscriberId/tags/:tag',
  restrictTo('owner', 'admin', 'agent'),
  validate(detachTagSchema),
  subscriberController.detachTagFromSubscriber
);

export default router;