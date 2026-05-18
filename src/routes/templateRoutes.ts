import express from 'express';
import * as templateController from '../controllers/templateController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import {
  createTemplateDraftSchema,
  createTemplateSchema,
  submitTemplateDraftSchema,
  templateDraftParamsSchema,
  templateParamsSchema,
  updateTemplateDraftSchema,
} from '../validations/templateValidation';

const router = express.Router();

// All template routes require the user to be logged in and inside an Organization context
router.use(protect);
router.use(setOrgContext);

// Agents can view templates, but only owners/admins can mutate template state in Meta
router.get('/', templateController.getTemplates);
router.get('/drafts', restrictTo('owner', 'admin'), templateController.getTemplateDrafts);
router.post(
  '/drafts',
  restrictTo('owner', 'admin'),
  validate(createTemplateDraftSchema),
  templateController.createTemplateDraft
);
router.get(
  '/drafts/:draftId',
  restrictTo('owner', 'admin'),
  validate(templateDraftParamsSchema),
  templateController.getTemplateDraft
);
router.patch(
  '/drafts/:draftId',
  restrictTo('owner', 'admin'),
  validate(updateTemplateDraftSchema),
  templateController.updateTemplateDraft
);
router.post(
  '/drafts/:draftId/submit',
  restrictTo('owner', 'admin'),
  validate(submitTemplateDraftSchema),
  templateController.submitTemplateDraft
);
router.delete(
  '/drafts/:draftId',
  restrictTo('owner', 'admin'),
  validate(templateDraftParamsSchema),
  templateController.deleteTemplateDraft
);
router.post('/', restrictTo('owner', 'admin'), validate(createTemplateSchema), templateController.createTemplate);
router.post('/sync', restrictTo('owner', 'admin'), templateController.syncTemplates);
router.get('/:templateId', validate(templateParamsSchema), templateController.getTemplate);
router.delete('/:templateId', restrictTo('owner', 'admin'), validate(templateParamsSchema), templateController.deleteTemplate);

export default router;
