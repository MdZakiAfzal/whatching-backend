import express from 'express';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import { optionalSingleAttachmentUpload } from '../middlewares/uploadMiddleware';
import * as botController from '../controllers/botController';
import {
  botFlowParamsSchema,
  createBotFlowSchema,
  createKnowledgeTextSchema,
  knowledgeSourceParamsSchema,
  patchBotSettingsSchema,
  publishBotCanvasSchema,
  updateBotFlowSchema,
} from '../validations/botValidation';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);
router.use(restrictTo('owner', 'admin'));

router.get('/settings', botController.getBotSettings);
router.patch('/settings', validate(patchBotSettingsSchema), botController.updateBotSettings);

router.get('/flows', botController.listBotFlows);
router.post('/flows', validate(createBotFlowSchema), botController.createBotFlow);
router.get('/flows/:flowId', validate(botFlowParamsSchema), botController.getBotFlow);
router.patch('/flows/:flowId', validate(updateBotFlowSchema), botController.updateBotFlow);
router.post('/flows/:flowId/publish', validate(botFlowParamsSchema), botController.publishBotFlow);
router.post('/flows/:flowId/archive', validate(botFlowParamsSchema), botController.archiveBotFlow);
router.post('/flows/publish-canvas', validate(publishBotCanvasSchema), botController.publishBotCanvas);

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
