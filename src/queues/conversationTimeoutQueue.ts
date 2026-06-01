import { Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';

export interface ConversationTimeoutJobData {
  orgId: string;
  conversationId: string;
  traceId: string;
  createdAt: string;
}

export const conversationTimeoutQueue = new Queue<ConversationTimeoutJobData>(
  QUEUE_NAMES.conversationTimeoutProcess,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  }
);

export const scheduleConversationTimeoutJob = async (
  data: ConversationTimeoutJobData,
  delayMs: number
) => {
  const jobId = `conversation-timeout_${data.conversationId}`;
  const existingJob = await conversationTimeoutQueue.getJob(jobId);
  if (existingJob) {
    await existingJob.remove();
  }

  await conversationTimeoutQueue.add('conversation-timeout', data, {
    jobId,
    delay: Math.max(0, delayMs),
  });
};
