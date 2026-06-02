import express from 'express';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import { optionalSingleAttachmentUpload } from '../middlewares/uploadMiddleware';
import * as botController from '../controllers/botController';
import {
  botCanvasParamsSchema,
  createBotCanvasSchema,
  createKnowledgeTextSchema,
  knowledgeSourceParamsSchema,
  patchBotSettingsSchema,
  publishBotCanvasDraftSchema,
  updateBotCanvasDraftSchema,
  updateBotCanvasSchema,
} from '../validations/botValidation';

const router = express.Router();

router.use(protect);
router.use(setOrgContext);
router.use(restrictTo('owner', 'admin'));

router.get('/settings', botController.getBotSettings);
router.patch('/settings', validate(patchBotSettingsSchema), botController.updateBotSettings);

router.get('/canvases', botController.listBotCanvases);
router.post('/canvases', validate(createBotCanvasSchema), botController.createBotCanvas);
router.get('/canvases/:canvasId', validate(botCanvasParamsSchema), botController.getBotCanvas);
router.patch('/canvases/:canvasId', validate(updateBotCanvasSchema), botController.updateBotCanvas);
router.post('/canvases/:canvasId/archive', validate(botCanvasParamsSchema), botController.archiveBotCanvas);
router.get('/canvases/:canvasId/draft', validate(botCanvasParamsSchema), botController.getBotCanvasDraft);
router.put('/canvases/:canvasId/draft', validate(updateBotCanvasDraftSchema), botController.saveBotCanvasDraft);
router.post('/canvases/:canvasId/validate', validate(botCanvasParamsSchema), botController.validateBotCanvas);
router.post('/canvases/:canvasId/publish', validate(publishBotCanvasDraftSchema), botController.publishBotCanvasDraft);
router.get('/canvases/:canvasId/published', validate(botCanvasParamsSchema), botController.getBotCanvasPublished);

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
