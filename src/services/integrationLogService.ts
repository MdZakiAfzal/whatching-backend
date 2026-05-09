import mongoose from 'mongoose';
import IntegrationLog from '../models/IntegrationLog';

interface LogIntegrationActionInput {
  orgId: mongoose.Types.ObjectId | string;
  actorUserId?: mongoose.Types.ObjectId | string;
  action: string;
  status: 'success' | 'failed';
  details?: Record<string, unknown>;
  externalRef?: string;
}

export const logIntegrationAction = async ({
  orgId,
  actorUserId,
  action,
  status,
  details,
  externalRef,
}: LogIntegrationActionInput) => {
  await IntegrationLog.create({
    orgId,
    actorUserId,
    action,
    status,
    details,
    externalRef,
  });
};
