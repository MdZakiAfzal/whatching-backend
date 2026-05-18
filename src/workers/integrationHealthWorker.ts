import { Job, Worker } from 'bullmq';
import Organization from '../models/Organization';
import {
  INTEGRATION_HEALTH_JOB_NAMES,
  IntegrationHealthJobData,
  enqueueOrganizationHealthSyncJob,
} from '../queues/integrationHealthQueue';
import { QUEUE_NAMES } from '../queues/names';
import { createWorkerConnection } from '../queues/redis';
import { syncOrganizationMessagingHealth } from '../services/metaOperationalService';

const processIntegrationHealthJob = async (job: Job<IntegrationHealthJobData>) => {
  if (job.name === INTEGRATION_HEALTH_JOB_NAMES.scanConnectedOrgs) {
    const organizations = await Organization.find({
      'metaConfig.status': 'ready',
      'metaConfig.accessToken': { $exists: true },
      'metaConfig.phoneNumberId': { $exists: true },
      'metaConfig.wabaId': { $exists: true },
    }).select('_id');

    for (const organization of organizations) {
      await enqueueOrganizationHealthSyncJob({
        orgId: String(organization._id),
        reason: 'scheduled_scan',
      });
    }

    return;
  }

  if (!job.data.orgId) {
    return;
  }

  const organization = await Organization.findById(job.data.orgId).select('+metaConfig.accessToken');
  if (!organization?.metaConfig?.accessToken) {
    return;
  }

  await syncOrganizationMessagingHealth(organization);
};

export const startIntegrationHealthWorker = () =>
  new Worker<IntegrationHealthJobData>(
    QUEUE_NAMES.integrationHealthSyncProcess,
    processIntegrationHealthJob,
    {
      connection: createWorkerConnection('whatching-integration-health-worker'),
      concurrency: 2,
    }
  );
