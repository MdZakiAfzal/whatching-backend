import { Request, Response } from 'express';
import { config } from '../config';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';

/**
 * META WEBHOOK VERIFICATION (GET)
 * This is required for Meta to verify your webhook URL.
 */
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check if a mode and token were sent
  if (mode && token) {
    // Check the mode and token sent are correct
    if (mode === 'subscribe' && token === config.meta.verifyToken) {
      // Respond with 200 OK and the challenge token from the request
      console.log('✅ WhatsApp Webhook Verified');
      return res.status(200).send(challenge);
    } else {
      // Responds with '403 Forbidden' if verify tokens do not match
      return res.sendStatus(403);
    }
  }
  
  res.sendStatus(400);
};

/**
 * INCOMING WHATSAPP MESSAGES (POST)
 * This is where real messages arrive.
 */
export const handleWebhook = catchAsync(async (req: Request, res: Response) => {
  const body = req.body;

  // IMPORTANT: WhatsApp webhooks have a specific nested structure
  // We check if it's a valid WhatsApp message notification
  if (body.object === 'whatsapp_business_account') {
    
    // Logic for processing goes here (Phase 4)
    // For now, return 200 immediately to Meta to avoid retries
    res.status(200).send('EVENT_RECEIVED');
    
    // TODO: Push to Redis queue for background worker processing
    return;
  }

  // If it's not a WhatsApp event, return 404
  res.sendStatus(404);
});