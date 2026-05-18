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
  updateSubscriberTagsSchema,
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
router.patch(
  '/:subscriberId/tags',
  restrictTo('owner', 'admin', 'agent'),
  validate(updateSubscriberTagsSchema),
  subscriberController.updateSubscriberTags
);

export default router;
