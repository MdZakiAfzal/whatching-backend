import { Job, Worker } from 'bullmq';
import WebhookEvent from '../models/WebhookEvent';
import { QUEUE_NAMES } from '../queues/names';
import { WhatsAppWebhookJobData } from '../queues/whatsappWebhookQueue';
import { createWorkerConnection } from '../queues/redis';

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
  if (!webhookEvent) {
    return;
  }

  if (webhookEvent.processingStatus === 'processed') {
    return;
  }

  await WebhookEvent.findByIdAndUpdate(webhookEvent._id, {
    processingStatus: 'processing',
  });

  try {
    const payload = webhookEvent.payload;

    if (payload?.object !== 'whatsapp_business_account') {
      await markWebhookProcessed(String(webhookEvent._id));
      return;
    }

    console.log(
      `[WhatsApp worker] processing webhook event=${webhookEvent.eventType} orgId=${webhookEvent.orgId ?? 'unmapped'}`
    );

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
