import { Request, Response } from 'express';
import { config } from '../config';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import crypto from 'crypto';
import WebhookEvent from '../models/WebhookEvent';
import { enqueueWhatsAppWebhookJob } from '../queues/whatsappWebhookQueue';
import * as whatsappService from '../services/whatsappService';
import { createRedisPubSubConnection } from '../queues/redis';

type RawBodyRequest = Request & { rawBody?: string };
const META_MESSAGE_ID_TTL_SECONDS = 24 * 60 * 60;
const webhookIdempotencyRedis = createRedisPubSubConnection('whatching-webhook-idempotency');

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

const computeWebhookEventId = (rawBody: string) =>
  crypto.createHash('sha256').update(rawBody).digest('hex');

const extractMetaWebhookDeduplicationKeys = (body: any) => {
  const ids = new Set<string>();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change?.value;
      for (const message of value?.messages ?? []) {
        if (typeof message?.id === 'string' && message.id.trim().length > 0) {
          ids.add(`message:${message.id.trim()}`);
        }
      }
      for (const status of value?.statuses ?? []) {
        if (typeof status?.id === 'string' && status.id.trim().length > 0) {
          ids.add(`status:${status.id.trim()}:${String(status.status || 'unknown').toLowerCase()}`);
        }
      }
    }
  }

  return [...ids];
};

const claimMetaWebhookKeys = async (deduplicationKeys: string[]) => {
  if (deduplicationKeys.length === 0) {
    return { hasIds: false, claimedAny: true, claimedKeys: [] as string[] };
  }

  let claimedCount = 0;
  const claimedKeys: string[] = [];
  for (const deduplicationKey of deduplicationKeys) {
    const result = await webhookIdempotencyRedis.set(
      `webhook:meta_msg:${deduplicationKey}`,
      '1',
      'EX',
      META_MESSAGE_ID_TTL_SECONDS,
      'NX'
    );
    if (result === 'OK') {
      claimedCount += 1;
      claimedKeys.push(deduplicationKey);
    }
  }

  return {
    hasIds: true,
    claimedAny: claimedCount > 0,
    claimedKeys,
  };
};

const releaseMetaWebhookKeys = async (deduplicationKeys: string[]) => {
  if (deduplicationKeys.length === 0) {
    return;
  }

  await webhookIdempotencyRedis.del(
    ...deduplicationKeys.map((deduplicationKey) => `webhook:meta_msg:${deduplicationKey}`)
  );
};

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
    let claimedDeduplicationKeys: string[] = [];
    try {
      const idempotency = await claimMetaWebhookKeys(extractMetaWebhookDeduplicationKeys(body));
      claimedDeduplicationKeys = idempotency.claimedKeys;
      if (idempotency.hasIds && !idempotency.claimedAny) {
        return res.status(200).send('EVENT_RECEIVED');
      }
    } catch (error) {
      console.warn('WhatsApp webhook idempotency check failed; continuing with normal processing.');
    }

    try {
      const eventId = computeWebhookEventId(rawBody);

      let webhookEvent;
      let shouldEnqueue = false;

      try {
        webhookEvent = await WebhookEvent.create({
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
        await enqueueWhatsAppWebhookJob({
          webhookEventId: String(webhookEvent._id),
          orgId: webhookEvent.orgId ? String(webhookEvent.orgId) : undefined,
        });
      }
    } catch (error) {
      try {
        await releaseMetaWebhookKeys(claimedDeduplicationKeys);
      } catch (releaseError) {
        console.warn('Failed to release WhatsApp webhook idempotency keys after enqueue failure.');
      }
      throw error;
    }

    res.status(200).send('EVENT_RECEIVED');
    return;
  }

  // If it's not a WhatsApp event, return 404
  res.sendStatus(404);
});
