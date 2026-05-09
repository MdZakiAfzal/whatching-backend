import express from 'express';
import * as templateController from '../controllers/templateController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import { validate } from '../middlewares/validateMiddleware';
import { createTemplateSchema, templateParamsSchema } from '../validations/templateValidation';

const router = express.Router();

// All template routes require the user to be logged in and inside an Organization context
router.use(protect);
router.use(setOrgContext);

// Agents can view templates, but only owners/admins can mutate template state in Meta
router.get('/', templateController.getTemplates);
router.post('/', restrictTo('owner', 'admin'), validate(createTemplateSchema), templateController.createTemplate);
router.post('/sync', restrictTo('owner', 'admin'), templateController.syncTemplates);
router.get('/:templateId', validate(templateParamsSchema), templateController.getTemplate);
router.delete('/:templateId', restrictTo('owner', 'admin'), validate(templateParamsSchema), templateController.deleteTemplate);

export default router;
