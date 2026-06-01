import { Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';

export interface KnowledgeIngestJobData {
  orgId: string;
  sourceId: string;
  initiatedBy?: string;
  traceId: string;
  createdAt: string;
}

export const knowledgeIngestQueue = new Queue<KnowledgeIngestJobData>(
  QUEUE_NAMES.knowledgeIngestProcess,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  }
);

export const enqueueKnowledgeIngestJob = async (data: KnowledgeIngestJobData) => {
  await knowledgeIngestQueue.add('knowledge-ingest', data, {
    jobId: `knowledge_${data.sourceId}`,
  });
};
