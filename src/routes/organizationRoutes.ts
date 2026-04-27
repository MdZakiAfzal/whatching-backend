import express from 'express';
import * as orgController from '../controllers/organizationController';

const router = express.Router();

// POST /api/v1/organizations/setup
router.post('/setup', orgController.setupOrganization);

export default router;