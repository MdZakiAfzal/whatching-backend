import { Queue } from 'bullmq';
import { queueConnection } from './redis';
import { QUEUE_NAMES } from './names';

export const INTEGRATION_HEALTH_JOB_NAMES = {
  scanConnectedOrgs: 'integration-scan-connected-orgs',
  syncOrgHealth: 'integration-sync-org-health',
} as const;

export interface IntegrationHealthJobData {
  orgId?: string;
  reason: 'connected' | 'manual_sync' | 'scheduled_scan';
}

export const integrationHealthQueue = new Queue<IntegrationHealthJobData>(
  QUEUE_NAMES.integrationHealthSyncProcess,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  }
);

export const enqueueOrganizationHealthSyncJob = async (data: IntegrationHealthJobData) => {
  if (!data.orgId) {
    return;
  }

  await integrationHealthQueue.add(INTEGRATION_HEALTH_JOB_NAMES.syncOrgHealth, data, {
    jobId: `integration:sync:${data.orgId}`,
  });
};

export const registerDailyIntegrationHealthScan = async () => {
  await integrationHealthQueue.add(
    INTEGRATION_HEALTH_JOB_NAMES.scanConnectedOrgs,
    { reason: 'scheduled_scan' },
    {
      jobId: 'integration:scan:daily',
      repeat: {
        every: 24 * 60 * 60 * 1000,
      },
    }
  );
};
