import express from 'express';
import * as orgController from '../controllers/organizationController';
import * as memberController from '../controllers/membershipController';
import { protect } from '../middlewares/authMiddleware';
import { setOrgContext } from '../middlewares/orgMiddleware';
import { restrictTo } from '../middlewares/roleMiddleware';
import * as paymentController from '../controllers/paymentController';
import * as webhookController from '../controllers/webhookController';

const router = express.Router();

router.post('/billing/webhook', webhookController.handleRazorpayWebhook);

router.use(protect);

// Global Org Routes
router.post('/setup', orgController.setupOrganization);
router.get('/my-organizations', orgController.getMyOrganizations);

// Contextual Org Routes (Requires x-org-id header)
router.use(setOrgContext);
router.get('/', orgController.getOrganization);
router.patch('/connect-meta', restrictTo('owner'), orgController.connectMeta);

// Agent Management
router.get('/team', memberController.getTeam);
router.post('/add-agent', restrictTo('owner'), memberController.addAgent);
router.delete('/team/:membershipId', restrictTo('owner'), memberController.removeMember);

router.get('/billing/history', restrictTo('owner'), paymentController.getBillingHistory);
router.post('/billing/subscribe', restrictTo('owner'), paymentController.startSubscription);
router.post('/billing/topup-wallet', restrictTo('owner'), paymentController.topupWallet);
router.post('/billing/cancel', restrictTo('owner'), paymentController.cancelMySubscription);

export default router;