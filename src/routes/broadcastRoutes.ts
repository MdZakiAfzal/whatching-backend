import express from 'express';
import * as broadcastController from '../controllers/broadcastController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import {
  broadcastParamsSchema,
  cancelBroadcastSchema,
  createBroadcastSchema,
  getBroadcastSchema,
  listBroadcastsSchema,
  startBroadcastSchema,
} from '../validations/broadcastValidation';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);
router.use(restrictTo('owner', 'admin'));

router.get('/', validate(listBroadcastsSchema), broadcastController.listBroadcasts);
router.post('/', validate(createBroadcastSchema), broadcastController.createBroadcast);
router.get('/:broadcastId', validate(getBroadcastSchema), broadcastController.getBroadcast);
router.post('/:broadcastId/start', validate(startBroadcastSchema), broadcastController.startBroadcast);
router.post('/:broadcastId/cancel', validate(cancelBroadcastSchema), broadcastController.cancelBroadcast);

export default router;
