import { Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';

export interface WhatsAppWebhookJobData {
  webhookEventId: string;
  orgId?: string;
}

export interface WhatsAppWebhookDlqJobData extends WhatsAppWebhookJobData {
  failedAt: string;
  attemptsMade: number;
  errorMessage: string;
}

export const whatsappWebhookQueue = new Queue<WhatsAppWebhookJobData>(
  QUEUE_NAMES.whatsappWebhookProcess,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    },
  }
);

export const whatsappWebhookDlqQueue = new Queue<WhatsAppWebhookDlqJobData>(
  QUEUE_NAMES.whatsappWebhookDlq,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    },
  }
);

export const enqueueWhatsAppWebhookJob = async (data: WhatsAppWebhookJobData) => {
  await whatsappWebhookQueue.add('process-whatsapp-webhook', data, {
    jobId: data.webhookEventId,
  });
};

export const enqueueWhatsAppWebhookDlqJob = async (data: WhatsAppWebhookDlqJobData) => {
  await whatsappWebhookDlqQueue.add('whatsapp-webhook-dlq', data, {
    jobId: `dlq_${data.webhookEventId}`,
  });
};
