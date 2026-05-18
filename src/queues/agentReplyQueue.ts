import { Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';

export type AgentReplyMessageType = 'text' | 'image' | 'document' | 'audio' | 'video';

export interface AgentReplyJobData {
  messageId: string;
  orgId: string;
  phoneNumberId: string;
  subscriberId: string;
  subscriberPhone: string;
  messageType: AgentReplyMessageType;
  text?: string;
  caption?: string;
  attachment?: {
    mediaUrl: string;
    mimeType: string;
    originalFilename?: string;
    publicId?: string;
  };
  initiatedBy: string;
  traceId: string;
  createdAt: string;
  replyToMetaMessageId?: string;
}

export const agentReplyQueue = new Queue<AgentReplyJobData>(
  QUEUE_NAMES.agentReplyProcess,
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

export const enqueueAgentReplyJob = async (data: AgentReplyJobData) => {
  await agentReplyQueue.add('send-agent-reply', data, { jobId: data.messageId });
};
