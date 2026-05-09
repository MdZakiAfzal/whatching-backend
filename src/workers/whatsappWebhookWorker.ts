import { Job, Worker } from 'bullmq';
import WebhookEvent from '../models/WebhookEvent';
import Message from '../models/Message';
import { upsertSubscriber } from '../services/subscriberService';
import { getOrCreateActiveConversation } from '../services/conversationService';
import { QUEUE_NAMES } from '../queues/names';
import { WhatsAppWebhookJobData } from '../queues/whatsappWebhookQueue';
import { createWorkerConnection } from '../queues/redis';
import Organization from '../models/Organization';

const updateMessageStatus = async (
  orgId: string,
  statusPayload: any
) => {
  const update: Record<string, unknown> = {};
  const normalizedStatus = String(statusPayload.status || '').toLowerCase();
  const eventTimestamp = statusPayload.timestamp
    ? new Date(Number(statusPayload.timestamp) * 1000)
    : new Date();

  if (normalizedStatus === 'delivered') {
    update.status = 'delivered';
    update.deliveredAt = eventTimestamp;
  } else if (normalizedStatus === 'read') {
    update.status = 'read';
    update.readAt = eventTimestamp;
  } else if (normalizedStatus === 'failed') {
    update.status = 'failed';
    update.failedAt = eventTimestamp;
    update.errorCode = statusPayload.errors?.[0]?.code ? String(statusPayload.errors[0].code) : undefined;
    update.errorMessage = statusPayload.errors?.[0]?.title || statusPayload.errors?.[0]?.message;
  } else if (normalizedStatus === 'sent') {
    update.status = 'sent';
    update.sentAt = eventTimestamp;
  } else {
    return;
  }

  await Message.findOneAndUpdate(
    {
      orgId,
      metaMessageId: statusPayload.id,
    },
    update
  );
};

const processInboundMessage = async (orgId: any, value: any, message: any) => {
  const phoneNumber = message.from;
  const matchedContact =
    value.contacts?.find((contact: any) => String(contact.wa_id || contact.input) === String(phoneNumber)) ||
    value.contacts?.[0];
  const profileName = matchedContact?.profile?.name;

  const subscriber = await upsertSubscriber(orgId, phoneNumber, profileName);

  let messageText = '';
  if (message.type === 'text') {
    messageText = message.text?.body || '';
  } else {
    messageText = `[Received ${message.type} message]`;
  }

  const conversation = await getOrCreateActiveConversation(
    orgId,
    subscriber._id as any,
    messageText
  );

  await Message.updateOne(
    {
      orgId,
      metaMessageId: message.id,
    },
    {
      $setOnInsert: {
        orgId,
        conversationId: (conversation as any)._id,
        subscriberId: subscriber._id,
        direction: 'inbound',
        type: message.type === 'text' ? 'text' : 'unknown',
        metaMessageId: message.id,
        status: 'received',
        payload: { text: messageText },
        sentAt: new Date(parseInt(message.timestamp, 10) * 1000),
      },
    },
    { upsert: true }
  );

  console.log(`✅ INBOX: Message from ${profileName || phoneNumber}: "${messageText}"`);
};

const markWebhookProcessed = async (webhookEventId: string) => {
  await WebhookEvent.findByIdAndUpdate(webhookEventId, {
    processingStatus: 'processed',
    processedAt: new Date(),
    $inc: { processingAttempts: 1 },
    $unset: { error: 1 },
  });
};

const markWebhookFailed = async (webhookEventId: string, error: unknown) => {
  await WebhookEvent.findByIdAndUpdate(webhookEventId, {
    processingStatus: 'failed',
    $inc: { processingAttempts: 1 },
    error: error instanceof Error ? error.message : 'Unknown worker error',
  });
};

const processWhatsAppWebhookJob = async (job: Job<WhatsAppWebhookJobData>) => {
  const webhookEvent = await WebhookEvent.findById(job.data.webhookEventId);
  if (!webhookEvent || webhookEvent.processingStatus === 'processed') return;

  await WebhookEvent.findByIdAndUpdate(webhookEvent._id, { processingStatus: 'processing' });

  try {
    const payload = webhookEvent.payload;

    if (payload?.object === 'whatsapp_business_account' && webhookEvent.orgId) {
      await Organization.findByIdAndUpdate(
        webhookEvent.orgId,
        {
          $set: {
            'metaConfig.webhookVerifiedAt': new Date(),
            'metaConfig.lastHealthCheckAt': new Date(),
          },
        }
      );

      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change?.value;

          for (const message of value?.messages ?? []) {
            await processInboundMessage(webhookEvent.orgId, value, message);
          }

          for (const statusPayload of value?.statuses ?? []) {
            await updateMessageStatus(String(webhookEvent.orgId), statusPayload);
          }
        }
      }
    }

    await markWebhookProcessed(String(webhookEvent._id));
  } catch (error) {
    await markWebhookFailed(String(webhookEvent._id), error);
    throw error;
  }
};

export const startWhatsAppWebhookWorker = () =>
  new Worker<WhatsAppWebhookJobData>(
    QUEUE_NAMES.whatsappWebhookProcess,
    processWhatsAppWebhookJob,
    {
      connection: createWorkerConnection('whatching-whatsapp-worker'),
      concurrency: 5,
    }
  );
