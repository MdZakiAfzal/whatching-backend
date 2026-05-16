import mongoose from 'mongoose';
import Broadcast, { IBroadcast } from '../models/Broadcast';
import BroadcastRecipient, { BroadcastRecipientStatus } from '../models/BroadcastRecipient';

const STATUS_COUNTER_FIELD: Partial<Record<BroadcastRecipientStatus, keyof IBroadcast['stats']>> = {
  queued: 'queuedRecipients',
  sent: 'sentRecipients',
  delivered: 'deliveredRecipients',
  read: 'readRecipients',
  failed: 'failedRecipients',
  skipped: 'skippedRecipients',
  canceled: 'canceledRecipients',
};

type BroadcastAudienceInput = {
  mode: 'all' | 'tags' | 'specific';
  tags?: string[];
  tagMatch?: 'any' | 'all';
  subscriberIds?: string[] | mongoose.Types.ObjectId[];
  optedInOnly?: boolean;
};

export const buildBroadcastAudienceFilter = (
  orgId: mongoose.Types.ObjectId | string,
  audience: BroadcastAudienceInput
) => {
  const filter: Record<string, unknown> = { orgId: new mongoose.Types.ObjectId(String(orgId)) };

  if (audience.optedInOnly !== false) {
    filter.isOptedIn = true;
  }

  if (audience.mode === 'tags') {
    const tags = (audience.tags || []).map((tag) => String(tag).trim()).filter(Boolean);
    if (tags.length > 0) {
      filter.tags = audience.tagMatch === 'all' ? { $all: tags } : { $in: tags };
    }
  }

  if (audience.mode === 'specific') {
    const subscriberIds = (audience.subscriberIds || []).map((subscriberId) =>
      new mongoose.Types.ObjectId(String(subscriberId))
    );
    filter._id = { $in: subscriberIds };
  }

  return filter;
};

export const countBroadcastAudience = async (
  SubscriberModel: any,
  orgId: mongoose.Types.ObjectId | string,
  audience: BroadcastAudienceInput
) => SubscriberModel.countDocuments(buildBroadcastAudienceFilter(orgId, audience));

export const refreshBroadcastCompletionState = async (broadcastId: mongoose.Types.ObjectId | string) => {
  const broadcast = await Broadcast.findById(broadcastId).select('status stats.queuedRecipients');
  if (!broadcast || broadcast.status !== 'in_progress' || broadcast.stats.queuedRecipients > 0) {
    return;
  }

  await Broadcast.findOneAndUpdate(
    {
      _id: broadcastId,
      status: 'in_progress',
      'stats.queuedRecipients': 0,
    },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
      },
      $unset: {
        lastError: 1,
      },
    }
  );
};

const buildStatsDelta = (
  previousStatus: BroadcastRecipientStatus,
  nextStatus: BroadcastRecipientStatus
) => {
  if (previousStatus === nextStatus) {
    return null;
  }

  const delta: Record<string, number> = {};
  const previousField = STATUS_COUNTER_FIELD[previousStatus];
  const nextField = STATUS_COUNTER_FIELD[nextStatus];

  if (previousField) {
    delta[`stats.${previousField}`] = -1;
  }

  if (nextField) {
    delta[`stats.${nextField}`] = (delta[`stats.${nextField}`] || 0) + 1;
  }

  return Object.keys(delta).length > 0 ? delta : null;
};

export const transitionBroadcastRecipientStatus = async ({
  filter,
  nextStatus,
  updates = {},
}: {
  filter: Record<string, unknown>;
  nextStatus: BroadcastRecipientStatus;
  updates?: Record<string, unknown>;
}) => {
  const currentRecipient = await BroadcastRecipient.findOne(filter).select('_id broadcastId status');

  if (!currentRecipient) {
    return null;
  }

  const updatedRecipient = await BroadcastRecipient.findByIdAndUpdate(
    currentRecipient._id,
    {
      $set: {
        status: nextStatus,
        ...updates,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    }
  );

  const delta = buildStatsDelta(currentRecipient.status, nextStatus);
  if (delta) {
    await Broadcast.findByIdAndUpdate(currentRecipient.broadcastId, {
      $inc: delta,
    });

    await refreshBroadcastCompletionState(currentRecipient.broadcastId);
  }

  return updatedRecipient;
};

export const markBroadcastFailed = async (
  broadcastId: mongoose.Types.ObjectId | string,
  reason: string
) => {
  await Broadcast.findByIdAndUpdate(broadcastId, {
    $set: {
      status: 'failed',
      lastError: reason,
    },
    $unset: {
      completedAt: 1,
    },
  });
};

export const markBroadcastCanceled = async (
  broadcastId: mongoose.Types.ObjectId | string,
  canceledAt = new Date()
) => {
  await Broadcast.findByIdAndUpdate(broadcastId, {
    $set: {
      status: 'canceled',
      canceledAt,
    },
  });
};

export const syncBroadcastRecipientFromMessageStatus = async ({
  orgId,
  messageId,
  metaMessageId,
  normalizedStatus,
  eventTimestamp,
  errorCode,
  errorMessage,
}: {
  orgId: string;
  messageId: mongoose.Types.ObjectId | string;
  metaMessageId?: string;
  normalizedStatus: string;
  eventTimestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}) => {
  if (normalizedStatus === 'delivered') {
    await transitionBroadcastRecipientStatus({
      filter: { orgId, messageId },
      nextStatus: 'delivered',
      updates: {
        deliveredAt: eventTimestamp,
        ...(metaMessageId ? { metaMessageId } : {}),
      },
    });
    return;
  }

  if (normalizedStatus === 'read') {
    await transitionBroadcastRecipientStatus({
      filter: { orgId, messageId },
      nextStatus: 'read',
      updates: {
        readAt: eventTimestamp,
        ...(metaMessageId ? { metaMessageId } : {}),
      },
    });
    return;
  }

  if (normalizedStatus === 'failed') {
    await transitionBroadcastRecipientStatus({
      filter: { orgId, messageId },
      nextStatus: 'failed',
      updates: {
        failedAt: eventTimestamp,
        errorCode,
        errorMessage,
        ...(metaMessageId ? { metaMessageId } : {}),
      },
    });
  }
};
