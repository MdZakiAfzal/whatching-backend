import { Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';
import mongoose from 'mongoose';

// Strictly define what data a "Send Template" job must contain
export interface TemplateSendJobData {
  messageId: string;
  orgId: string;
  wabaId: string;
  phoneNumberId: string;
  subscriberId: string;
  subscriberPhone: string;
  templateName: string;
  templateId: string;
  languageCode: string;
  components: any[]; // For dynamic variables like {{1}}
  cost: number;
  initiatedBy: string; // The user ID who triggered the send
  traceId: string;
  createdAt: string;
}

export const templateSendQueue = new Queue<TemplateSendJobData>(
  QUEUE_NAMES.templateSendProcess,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000, // Retry after 2s, 4s, 8s if Meta API hiccups
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  }
);

export const enqueueTemplateSendJob = async (data: TemplateSendJobData) => {
  await templateSendQueue.add('send-template', data, { jobId: data.messageId });
};
