import { Job, Worker } from 'bullmq';
import { QUEUE_NAMES } from '../queues/names';
import { KnowledgeIngestJobData } from '../queues/knowledgeIngestQueue';
import { createWorkerConnection } from '../queues/redis';
import { createKnowledgeChunksForSource } from '../services/knowledgeService';

const processKnowledgeIngestJob = async (job: Job<KnowledgeIngestJobData>) => {
  await createKnowledgeChunksForSource(job.data.sourceId);
};

export const startKnowledgeIngestWorker = () =>
  new Worker<KnowledgeIngestJobData>(
    QUEUE_NAMES.knowledgeIngestProcess,
    processKnowledgeIngestJob,
    {
      connection: createWorkerConnection('whatching-knowledge-ingest-worker'),
      concurrency: 3,
    }
  );
