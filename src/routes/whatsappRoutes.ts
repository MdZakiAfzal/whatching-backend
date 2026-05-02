import express from 'express';
import * as whatsappController from '../controllers/whatsappController';

const router = express.Router();

// The endpoint will be /api/v1/whatsapp/webhook
router.get('/webhook', whatsappController.verifyWebhook);
router.post('/webhook', whatsappController.handleWebhook);

export default router;