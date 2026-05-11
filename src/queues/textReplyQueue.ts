import { Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';

export interface TextReplyJobData {
  messageId: string;
  orgId: string;
  phoneNumberId: string;
  subscriberId: string;
  subscriberPhone: string;
  text: string;
  initiatedBy: string;
  traceId: string;
  createdAt: string;
  replyToMetaMessageId?: string;
}

export const textReplyQueue = new Queue<TextReplyJobData>(
  QUEUE_NAMES.textReplyProcess,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  }
);

export const enqueueTextReplyJob = async (data: TextReplyJobData) => {
  await textReplyQueue.add('send-text-reply', data, { jobId: data.messageId });
};
