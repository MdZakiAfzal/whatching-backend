import express from 'express';
import * as orgController from '../controllers/organizationController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

// All organization routes require the user to be logged in
router.use(protect);

router.post('/setup', orgController.setupOrganization);
router.patch('/connect-meta', orgController.connectMeta); // For Stage 2

export default router;