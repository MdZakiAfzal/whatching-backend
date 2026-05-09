import express from 'express';
import * as templateController from '../controllers/templateController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';

const router = express.Router();

// All template routes require the user to be logged in and inside an Organization context
router.use(protect);
router.use(setOrgContext);

// Agents can view templates, but only owners/admins can trigger a sync with Meta
router.get('/', templateController.getTemplates);
router.post('/sync', restrictTo('owner', 'admin'), templateController.syncTemplates);

export default router;