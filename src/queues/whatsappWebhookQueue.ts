import { Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';

export interface WhatsAppWebhookJobData {
  webhookEventId: string;
  orgId?: string;
}

export const whatsappWebhookQueue = new Queue<WhatsAppWebhookJobData>(
  QUEUE_NAMES.whatsappWebhookProcess,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    },
  }
);

export const enqueueWhatsAppWebhookJob = async (data: WhatsAppWebhookJobData) => {
  await whatsappWebhookQueue.add('process-whatsapp-webhook', data, {
    jobId: data.webhookEventId,
  });
};
