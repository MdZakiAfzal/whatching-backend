import { JobsOptions, Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';

export const BROADCAST_JOB_NAMES = {
  start: 'broadcast-start',
  recipient: 'broadcast-recipient-send',
} as const;

export interface BroadcastStartJobData {
  broadcastId: string;
  orgId: string;
  initiatedBy: string;
  traceId: string;
  createdAt: string;
}

export interface BroadcastRecipientJobData {
  broadcastId: string;
  recipientId: string;
  orgId: string;
  initiatedBy: string;
  traceId: string;
  createdAt: string;
}

export const broadcastFanoutQueue = new Queue<
  BroadcastStartJobData | BroadcastRecipientJobData
>(QUEUE_NAMES.broadcastFanoutProcess, {
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
});

const getBroadcastStartJobId = (broadcastId: string) => `broadcast:start:${broadcastId}`;
const getBroadcastRecipientJobId = (recipientId: string) => `broadcast:recipient:${recipientId}`;

export const enqueueBroadcastStartJob = async (
  data: BroadcastStartJobData,
  options: JobsOptions = {}
) => {
  await broadcastFanoutQueue.add(BROADCAST_JOB_NAMES.start, data, {
    jobId: getBroadcastStartJobId(data.broadcastId),
    attempts: 1,
    ...options,
  });
};

export const enqueueBroadcastRecipientJobs = async (jobs: BroadcastRecipientJobData[]) => {
  if (jobs.length === 0) {
    return;
  }

  await broadcastFanoutQueue.addBulk(
    jobs.map((job) => ({
      name: BROADCAST_JOB_NAMES.recipient,
      data: job,
      opts: {
        jobId: getBroadcastRecipientJobId(job.recipientId),
      },
    }))
  );
};

export const removeScheduledBroadcastStartJob = async (broadcastId: string) => {
  const job = await broadcastFanoutQueue.getJob(getBroadcastStartJobId(broadcastId));
  if (job) {
    await job.remove();
  }
};
