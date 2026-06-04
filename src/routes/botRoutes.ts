import express from 'express';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import { optionalSingleAttachmentUpload } from '../middlewares/uploadMiddleware';
import * as botController from '../controllers/botController';
import {
  createKnowledgeTextSchema,
  knowledgeSourceParamsSchema,
  patchBotSettingsSchema,
  publishBotCanvasDraftSchema,
  updateBotCanvasDraftSchema,
} from '../validations/botValidation';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);
router.use(restrictTo('owner', 'admin'));

router.get('/settings', botController.getBotSettings);
router.patch('/settings', validate(patchBotSettingsSchema), botController.updateBotSettings);

router.get('/canvas/draft', botController.getBotCanvasDraft);
router.put('/canvas/draft', validate(updateBotCanvasDraftSchema), botController.saveBotCanvasDraft);
router.post('/canvas/validate', botController.validateBotCanvas);
router.post('/canvas/publish', validate(publishBotCanvasDraftSchema), botController.publishBotCanvasDraft);
router.get('/canvas/published', botController.getBotCanvasPublished);

router.get('/knowledge-sources', botController.listKnowledgeSources);
router.post('/knowledge-sources/text', validate(createKnowledgeTextSchema), botController.createKnowledgeTextSource);
router.post(
  '/knowledge-sources/upload',
  optionalSingleAttachmentUpload('file'),
  botController.uploadKnowledgeSource 
);
router.delete(
  '/knowledge-sources/:sourceId',
  validate(knowledgeSourceParamsSchema),
  botController.deleteKnowledgeSource
);
router.post(
  '/knowledge-sources/:sourceId/reingest',
  validate(knowledgeSourceParamsSchema),
  botController.reingestKnowledgeSource
);

router.get('/status', botController.getBotStatus);

export default router;
