import { Job, Worker } from 'bullmq';
import axios from 'axios';
import mongoose from 'mongoose';
import Broadcast from '../models/Broadcast';
import BroadcastRecipient from '../models/BroadcastRecipient';
import Subscriber from '../models/Subscriber';
import Organization from '../models/Organization';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import Message from '../models/Message';
import {
  BROADCAST_JOB_NAMES,
  BroadcastRecipientJobData,
  BroadcastStartJobData,
  enqueueBroadcastRecipientJobs,
} from '../queues/broadcastFanoutQueue';
import { QUEUE_NAMES } from '../queues/names';
import { createWorkerConnection } from '../queues/redis';
import {
  buildBroadcastAudienceFilter,
  markBroadcastFailed,
  refreshBroadcastCompletionState,
  transitionBroadcastRecipientStatus,
} from '../services/broadcastService';
import { logIntegrationAction } from '../services/integrationLogService';
import { getOrCreateActiveConversation } from '../services/conversationService';
import { decrypt } from '../utils/encryption';
import { trackMessagingUsage } from '../services/usageService';

const BROADCAST_CHUNK_SIZE = 250;

const processBroadcastStartJob = async (job: Job<BroadcastStartJobData>) => {
  const broadcast = await Broadcast.findById(job.data.broadcastId);
  if (!broadcast) {
    return;
  }

  if (broadcast.status === 'canceled' || broadcast.status === 'completed') {
    return;
  }

  const org = await Organization.findById(broadcast.orgId);
  if (!org?.metaConfig?.status || org.metaConfig.status !== 'ready' || !org.metaConfig.phoneNumberId) {
    await markBroadcastFailed(broadcast._id, 'Meta integration is not ready for broadcast delivery.');
    await logIntegrationAction({
      orgId: broadcast.orgId,
      actorUserId: job.data.initiatedBy,
      action: 'broadcast_start_failed',
      status: 'failed',
      details: {
        broadcastId: String(broadcast._id),
        reason: 'Meta integration is not ready for broadcast delivery.',
      },
      externalRef: String(broadcast._id),
    });
    return;
  }

  const template = await WhatsAppTemplate.findOne({
    orgId: broadcast.orgId,
    templateId: broadcast.template.templateId,
  });

  if (!template || template.status !== 'APPROVED') {
    const reason = !template
      ? 'Selected template no longer exists in this organization.'
      : `Selected template is no longer approved. Current status is ${template.status}.`;
    await markBroadcastFailed(broadcast._id, reason);
    await logIntegrationAction({
      orgId: broadcast.orgId,
      actorUserId: job.data.initiatedBy,
      action: 'broadcast_start_failed',
      status: 'failed',
      details: {
        broadcastId: String(broadcast._id),
        reason,
      },
      externalRef: String(broadcast._id),
    });
    return;
  }

  const audienceFilter = buildBroadcastAudienceFilter(broadcast.orgId, broadcast.audience as any);
  const cursor = Subscriber.find(audienceFilter)
    .sort({ _id: 1 })
    .select('_id phoneNumber isOptedIn')
    .cursor();

  let totalRecipientsCreated = 0;
  let queuedRecipientsCreated = 0;
  let setupError: string | null = null;
  let broadcastCanceled = false;
  let chunk: Array<{ _id: mongoose.Types.ObjectId; phoneNumber: string }> = [];

  const flushChunk = async () => {
    if (chunk.length === 0) {
      return;
    }

    const latestState = await Broadcast.findById(broadcast._id).select('status');
    if (latestState?.status === 'canceled') {
      broadcastCanceled = true;
      chunk = [];
      return;
    }

    const recipientDocs = chunk.map((subscriber) => ({
      _id: new mongoose.Types.ObjectId(),
      orgId: broadcast.orgId,
      broadcastId: broadcast._id,
      subscriberId: subscriber._id,
      phoneNumber: subscriber.phoneNumber,
      status: 'queued' as const,
      queuedAt: new Date(),
    }));
    let statsApplied = false;

    try {
      await BroadcastRecipient.insertMany(recipientDocs, { ordered: true });

      await Broadcast.findByIdAndUpdate(broadcast._id, {
        $inc: {
          'stats.totalRecipients': recipientDocs.length,
          'stats.queuedRecipients': recipientDocs.length,
        },
      });
      statsApplied = true;

      await enqueueBroadcastRecipientJobs(
        recipientDocs.map((recipientDoc) => ({
          broadcastId: String(broadcast._id),
          recipientId: String(recipientDoc._id),
          orgId: String(broadcast.orgId),
          initiatedBy: job.data.initiatedBy,
          traceId: `${job.data.traceId}:${String(recipientDoc._id)}`,
          createdAt: new Date().toISOString(),
        }))
      );

      totalRecipientsCreated += recipientDocs.length;
      queuedRecipientsCreated += recipientDocs.length;
      chunk = [];
    } catch (error) {
      const failedIds = recipientDocs.map((recipientDoc) => recipientDoc._id);

      const failedTransitionResult = await BroadcastRecipient.updateMany(
        {
          _id: { $in: failedIds },
          broadcastId: broadcast._id,
          orgId: broadcast.orgId,
          status: 'queued',
        },
        {
          $set: {
            status: 'failed',
            failedAt: new Date(),
            errorMessage: 'Broadcast queueing failed before delivery.',
          },
        }
      );

      if (statsApplied && failedTransitionResult.modifiedCount > 0) {
        await Broadcast.findByIdAndUpdate(broadcast._id, {
          $inc: {
            'stats.queuedRecipients': -failedTransitionResult.modifiedCount,
            'stats.failedRecipients': failedTransitionResult.modifiedCount,
          },
          $set: {
            lastError:
              error instanceof Error
                ? error.message
                : 'Broadcast recipient preparation failed unexpectedly.',
          },
        });
      }

      setupError =
        error instanceof Error
          ? error.message
          : 'Broadcast recipient preparation failed unexpectedly.';

      if (queuedRecipientsCreated === 0) {
        await markBroadcastFailed(broadcast._id, setupError);
      } else {
        await Broadcast.findByIdAndUpdate(broadcast._id, {
          $set: {
            lastError: setupError,
          },
        });
      }

      chunk = [];
      throw error;
    }
  };

  try {
    for await (const subscriber of cursor as any) {
      if (broadcastCanceled) {
        break;
      }

      chunk.push({
        _id: subscriber._id,
        phoneNumber: subscriber.phoneNumber,
      });

      if (chunk.length >= BROADCAST_CHUNK_SIZE) {
        await flushChunk();
      }
    }

    if (!broadcastCanceled) {
      await flushChunk();
    }
  } catch (error) {
    if (!setupError) {
      setupError = error instanceof Error ? error.message : 'Broadcast recipient preparation failed.';
    }
  }

  const currentBroadcast = await Broadcast.findById(broadcast._id).select('orgId status stats startedAt');
  if (!currentBroadcast) {
    return;
  }

  if (currentBroadcast.status === 'canceled') {
    return;
  }

  if (totalRecipientsCreated === 0) {
    const reason = setupError || 'No eligible subscribers matched this broadcast audience.';
    await markBroadcastFailed(currentBroadcast._id, reason);
    await logIntegrationAction({
      orgId: currentBroadcast.orgId,
      actorUserId: job.data.initiatedBy,
      action: 'broadcast_start_failed',
      status: 'failed',
      details: {
        broadcastId: String(currentBroadcast._id),
        reason,
      },
      externalRef: String(currentBroadcast._id),
    });
    return;
  }

  await Broadcast.findByIdAndUpdate(currentBroadcast._id, {
    $set: {
      status: 'in_progress',
      startedAt: currentBroadcast.startedAt || new Date(),
      ...(setupError ? { lastError: setupError } : {}),
    },
  });

  await refreshBroadcastCompletionState(currentBroadcast._id);

  await logIntegrationAction({
    orgId: currentBroadcast.orgId,
    actorUserId: job.data.initiatedBy,
    action: setupError ? 'broadcast_started_with_errors' : 'broadcast_processing_started',
    status: setupError ? 'failed' : 'success',
    details: {
      broadcastId: String(currentBroadcast._id),
      totalRecipientsCreated,
      queuedRecipientsCreated,
      ...(setupError ? { reason: setupError } : {}),
    },
    externalRef: String(currentBroadcast._id),
  });
};

const processBroadcastRecipientJob = async (job: Job<BroadcastRecipientJobData>) => {
  const recipient = await BroadcastRecipient.findById(job.data.recipientId);
  if (!recipient) {
    return;
  }

  if (!['queued', 'pending'].includes(recipient.status)) {
    return;
  }

  const broadcast = await Broadcast.findById(job.data.broadcastId);
  if (!broadcast) {
    return;
  }

  if (broadcast.status === 'canceled') {
    await transitionBroadcastRecipientStatus({
      filter: { _id: recipient._id, orgId: recipient.orgId },
      nextStatus: 'canceled',
      updates: {
        canceledAt: new Date(),
        errorMessage: 'Broadcast was canceled before this recipient could be processed.',
      },
    });
    return;
  }

  const [org, subscriber] = await Promise.all([
    Organization.findById(recipient.orgId).select('+metaConfig.accessToken'),
    Subscriber.findOne({ _id: recipient.subscriberId, orgId: recipient.orgId }),
  ]);

  if (!org?.metaConfig?.accessToken || !org.metaConfig.phoneNumberId) {
    await transitionBroadcastRecipientStatus({
      filter: { _id: recipient._id, orgId: recipient.orgId },
      nextStatus: 'failed',
      updates: {
        failedAt: new Date(),
        errorMessage: 'Missing Meta access token or phone number configuration.',
      },
    });
    return;
  }

  if (!subscriber) {
    await transitionBroadcastRecipientStatus({
      filter: { _id: recipient._id, orgId: recipient.orgId },
      nextStatus: 'failed',
      updates: {
        failedAt: new Date(),
        errorMessage: 'Subscriber record could not be found for this broadcast recipient.',
      },
    });
    return;
  }

  if (!subscriber.isOptedIn) {
    await transitionBroadcastRecipientStatus({
      filter: { _id: recipient._id, orgId: recipient.orgId },
      nextStatus: 'skipped',
      updates: {
        skippedAt: new Date(),
        errorMessage: 'Subscriber is opted out and was skipped before delivery.',
      },
    });
    return;
  }

  const token = decrypt(org.metaConfig.accessToken);
  const conversation = await getOrCreateActiveConversation(
    recipient.orgId as any,
    recipient.subscriberId as any,
    `[Broadcast: ${broadcast.name}]`
  );

  const messageId = recipient.messageId || new mongoose.Types.ObjectId();

  if (!recipient.messageId) {
    await Message.create({
      _id: messageId,
      orgId: recipient.orgId,
      conversationId: (conversation as any)._id,
      subscriberId: recipient.subscriberId,
      direction: 'outbound',
      type: 'template',
      templateId: broadcast.template.templateId,
      status: 'queued',
      payload: {
        text: `[Broadcast: ${broadcast.name}]`,
        components: broadcast.payload.components,
        broadcastId: String(broadcast._id),
        broadcastName: broadcast.name,
      },
    });

    await BroadcastRecipient.findByIdAndUpdate(recipient._id, {
      $set: {
        messageId,
      },
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: recipient.phoneNumber,
    type: 'template',
    template: {
      name: broadcast.template.name,
      language: { code: broadcast.template.language },
      components: broadcast.payload.components || [],
    },
  };

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${org.metaConfig.phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const metaMessageId = response.data.messages?.[0]?.id;
    if (!metaMessageId) {
      throw new Error('Meta did not return a message id for the broadcast recipient send.');
    }

    await Message.findByIdAndUpdate(messageId, {
      metaMessageId,
      status: 'sent',
      sentAt: new Date(),
      errorCode: undefined,
      errorMessage: undefined,
      failedAt: undefined,
      payload: {
        text: `[Broadcast: ${broadcast.name}]`,
        to: recipient.phoneNumber,
        components: broadcast.payload.components,
        broadcastId: String(broadcast._id),
      },
    });

    await transitionBroadcastRecipientStatus({
      filter: { _id: recipient._id, orgId: recipient.orgId },
      nextStatus: 'sent',
      updates: {
        sentAt: new Date(),
        messageId,
        metaMessageId,
        errorCode: undefined,
        errorMessage: undefined,
      },
    });

    await trackMessagingUsage(recipient.orgId, 'templateMessagesSent');
  } catch (error: any) {
    console.error(`❌ Broadcast Meta API Error (Org: ${job.data.orgId}):`, error.response?.data || error.message);

    const providerError = error.response?.data?.error;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    if (!providerError && !isFinalAttempt) {
      throw error;
    }

    const failureMessage = providerError
      ? `Meta rejected broadcast delivery (${providerError.code || 'unknown'}): ${
          providerError.message || 'Unknown Meta error'
        }`
      : `Broadcast delivery failed: ${error.message}`;

    await Message.findByIdAndUpdate(messageId, {
      status: 'failed',
      failedAt: new Date(),
      errorCode: providerError?.code ? String(providerError.code) : undefined,
      errorMessage: failureMessage,
    });

    await transitionBroadcastRecipientStatus({
      filter: { _id: recipient._id, orgId: recipient.orgId },
      nextStatus: 'failed',
      updates: {
        messageId,
        failedAt: new Date(),
        errorCode: providerError?.code ? String(providerError.code) : undefined,
        errorMessage: failureMessage,
      },
    });
  }
};

const processBroadcastJob = async (job: Job<BroadcastStartJobData | BroadcastRecipientJobData>) => {
  if (job.name === BROADCAST_JOB_NAMES.start) {
    await processBroadcastStartJob(job as Job<BroadcastStartJobData>);
    return;
  }

  if (job.name === BROADCAST_JOB_NAMES.recipient) {
    await processBroadcastRecipientJob(job as Job<BroadcastRecipientJobData>);
  }
};

export const startBroadcastFanoutWorker = () =>
  new Worker<BroadcastStartJobData | BroadcastRecipientJobData>(
    QUEUE_NAMES.broadcastFanoutProcess,
    processBroadcastJob,
    {
      connection: createWorkerConnection('whatching-broadcast-worker'),
      concurrency: 10,
      limiter: {
        max: 25,
        duration: 1000,
      },
    }
  );
