import { Request, Response } from 'express';
import { config } from '../config';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import crypto from 'crypto';
import Organization from '../models/Organization';
import WebhookEvent from '../models/WebhookEvent';
import { enqueueWhatsAppWebhookJob } from '../queues/whatsappWebhookQueue';
import * as whatsappService from '../services/whatsappService';

type RawBodyRequest = Request & { rawBody?: string };

const extractEventType = (body: any) => {
  const fields = new Set<string>();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (typeof change.field === 'string') {
        fields.add(change.field);
      }
    }
  }

  return fields.size > 0 ? [...fields].join(',') : 'unknown';
};

const extractPhoneNumberId = (body: any) => {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change?.value?.metadata?.phone_number_id;
      if (typeof phoneNumberId === 'string' && phoneNumberId.length > 0) {
        return phoneNumberId;
      }
    }
  }

  return undefined;
};

const resolveOrgIdFromWebhook = async (body: any) => {
  const phoneNumberId = extractPhoneNumberId(body);
  if (!phoneNumberId) {
    return undefined;
  }

  const organization = await Organization.findOne({
    'metaConfig.phoneNumberId': phoneNumberId,
  }).select('_id');

  return organization ? String(organization._id) : undefined;
};

const computeWebhookEventId = (rawBody: string) =>
  crypto.createHash('sha256').update(rawBody).digest('hex');

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
  const rawBody = (req as RawBodyRequest).rawBody ?? JSON.stringify(body);
  const signatureHeader = req.headers['x-hub-signature-256'];
  const signatureVerified = whatsappService.verifyMetaWebhookSignature(
    rawBody,
    typeof signatureHeader === 'string' ? signatureHeader : undefined
  );

  if (config.env === 'production' && !signatureVerified) {
    return res.sendStatus(401);
  }

  // IMPORTANT: WhatsApp webhooks have a specific nested structure
  // We check if it's a valid WhatsApp message notification
  if (body.object === 'whatsapp_business_account') {
    const eventId = computeWebhookEventId(rawBody);

    let webhookEvent;
    let shouldEnqueue = false;

    try {
      webhookEvent = await WebhookEvent.create({
        orgId: await resolveOrgIdFromWebhook(body),
        provider: 'whatsapp',
        eventType: extractEventType(body),
        eventId,
        signatureVerified,
        payload: body,
        processingStatus: 'pending',
      });
      shouldEnqueue = true;
    } catch (error: any) {
      if (error?.code === 11000) {
        webhookEvent = await WebhookEvent.findOne({
          provider: 'whatsapp',
          eventId,
        });
      } else {
        throw error;
      }
    }

    if (webhookEvent && shouldEnqueue) {
      if (webhookEvent.orgId) {
        await Organization.findByIdAndUpdate(webhookEvent.orgId, {
          $set: {
            'metaConfig.webhookVerifiedAt': new Date(),
            'metaConfig.lastHealthCheckAt': new Date(),
          },
        });
      }

      await enqueueWhatsAppWebhookJob({
        webhookEventId: String(webhookEvent._id),
        orgId: webhookEvent.orgId ? String(webhookEvent.orgId) : undefined,
      });
    }

    res.status(200).send('EVENT_RECEIVED');
    return;
  }

  // If it's not a WhatsApp event, return 404
  res.sendStatus(404);
});
