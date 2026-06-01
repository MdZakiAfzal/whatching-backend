import { Job, Worker } from 'bullmq';
import Conversation from '../models/Conversation';
import { QUEUE_NAMES } from '../queues/names';
import { ConversationTimeoutJobData } from '../queues/conversationTimeoutQueue';
import { createWorkerConnection } from '../queues/redis';
import {
  createSystemConversationMessage,
} from '../services/botMessagingService';
import Subscriber from '../models/Subscriber';
import Organization from '../models/Organization';
import { publishBotResumedEvent, publishConversationUpdated } from '../services/realtimeService';

const processConversationTimeoutJob = async (job: Job<ConversationTimeoutJobData>) => {
  const { orgId, conversationId } = job.data;

  const conversation = await Conversation.findOne({
    _id: conversationId,
    orgId,
  });

  if (!conversation) {
    return;
  }

  if (
    !conversation.automationPausedUntil ||
    conversation.automationPausedUntil.getTime() > Date.now()
  ) {
    return;
  }

  conversation.mode = 'interactive';
  conversation.status = 'resolved';
  conversation.automationPausedUntil = undefined;
  conversation.handoffReason = undefined;
  conversation.handoffRequestedAt = undefined;
  conversation.manualTakeoverAt = undefined;
  conversation.manualTakeoverBy = undefined;
  conversation.lastAgentReplyAt = undefined;
  await conversation.save();

  const [organization, subscriber] = await Promise.all([
    Organization.findById(orgId),
    Subscriber.findById(conversation.subscriberId),
  ]);

  if (organization && subscriber) {
    await createSystemConversationMessage({
      organization,
      conversation,
      subscriber,
      previewText: 'Bot resumed automatically after agent inactivity.',
      systemEventType: 'bot_resumed',
    });
  }

  await publishConversationUpdated(orgId, conversationId);
  await publishBotResumedEvent(orgId, conversationId);
};

export const startConversationTimeoutWorker = () =>
  new Worker<ConversationTimeoutJobData>(
    QUEUE_NAMES.conversationTimeoutProcess,
    processConversationTimeoutJob,
    {
      connection: createWorkerConnection('whatching-conversation-timeout-worker'),
      concurrency: 10,
    }
  );
