import express from 'express';
import * as orgController from '../controllers/organizationController';
import * as memberController from '../controllers/membershipController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';

const router = express.Router();

router.use(protect);

// Global Org Routes
router.post('/setup', orgController.setupOrganization);
router.get('/my-organizations', orgController.getMyOrganizations);

// Contextual Org Routes (Requires x-org-id header)
router.use(setOrgContext);

router.patch('/connect-meta', restrictTo('owner'), orgController.connectMeta);

// Agent Management
router.get('/team', memberController.getTeam);
router.post('/add-agent', restrictTo('owner'), memberController.addAgent);
router.delete('/team/:membershipId', restrictTo('owner'), memberController.removeMember);

export default router;