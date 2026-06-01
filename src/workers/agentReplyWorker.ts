import { Job, Worker } from 'bullmq';
import axios from 'axios';
import Organization from '../models/Organization';
import Message from '../models/Message';
import { QUEUE_NAMES } from '../queues/names';
import { AgentReplyJobData } from '../queues/agentReplyQueue';
import { createWorkerConnection } from '../queues/redis';
import { decrypt } from '../utils/encryption';
import Conversation from '../models/Conversation';
import { publishConversationUpdated, publishMessageUpdated } from '../services/realtimeService';

const buildReplyPayload = (data: AgentReplyJobData) => {
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: data.subscriberPhone,
    type: data.messageType,
  };

  if (data.replyToMetaMessageId) {
    payload.context = {
      message_id: data.replyToMetaMessageId,
    };
  }

  if (data.messageType === 'text') {
    payload.text = {
      preview_url: false,
      body: data.text,
    };
    return payload;
  }

  if (!data.attachment?.mediaUrl) {
    throw new Error('Missing attachment URL for outbound media reply.');
  }

  if (data.messageType === 'image') {
    payload.image = {
      link: data.attachment.mediaUrl,
      ...(data.caption ? { caption: data.caption } : {}),
    };
    return payload;
  }

  if (data.messageType === 'document') {
    payload.document = {
      link: data.attachment.mediaUrl,
      ...(data.caption ? { caption: data.caption } : {}),
      ...(data.attachment.originalFilename ? { filename: data.attachment.originalFilename } : {}),
    };
    return payload;
  }

  if (data.messageType === 'video') {
    payload.video = {
      link: data.attachment.mediaUrl,
      ...(data.caption ? { caption: data.caption } : {}),
    };
    return payload;
  }

  payload.audio = {
    link: data.attachment.mediaUrl,
  };

  return payload;
};

const markReplySent = async (data: AgentReplyJobData, metaMessageId: string) => {
  const message = await Message.findByIdAndUpdate(data.messageId, {
    metaMessageId,
    status: 'sent',
    sentAt: new Date(),
    errorCode: undefined,
    errorMessage: undefined,
    failedAt: undefined,
    payload: {
      ...(data.text ? { text: data.text } : {}),
      ...(data.caption ? { caption: data.caption } : {}),
      ...(data.attachment
        ? {
            mediaUrl: data.attachment.mediaUrl,
            mimeType: data.attachment.mimeType,
            filename: data.attachment.originalFilename,
            publicId: data.attachment.publicId,
      }
        : {}),
      to: data.subscriberPhone,
    },
  }, { returnDocument: 'after' });

  if (message) {
    await Conversation.findByIdAndUpdate(message.conversationId, {
      $set: {
        lastOutboundMetaMessageId: metaMessageId,
      },
    });
    await publishMessageUpdated(String(message.orgId), String(message.conversationId), String(message._id));
    await publishConversationUpdated(String(message.orgId), String(message.conversationId));
  }
};

const markReplyFailed = async (
  messageId: string,
  description: string,
  errorCode?: string
) => {
  const message = await Message.findByIdAndUpdate(messageId, {
    status: 'failed',
    failedAt: new Date(),
    errorCode,
    errorMessage: description,
  }, { returnDocument: 'after' });

  if (message) {
    await publishMessageUpdated(String(message.orgId), String(message.conversationId), String(message._id));
    await publishConversationUpdated(String(message.orgId), String(message.conversationId));
  }
};

const processAgentReplyJob = async (job: Job<AgentReplyJobData>) => {
  const data = job.data;

  const org = await Organization.findById(data.orgId).select('+metaConfig.accessToken');
  if (!org?.metaConfig?.accessToken) {
    throw new Error(`Missing access token for org: ${data.orgId}`);
  }

  const token = decrypt(org.metaConfig.accessToken);
  const payload = buildReplyPayload(data);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${data.phoneNumberId}/messages`,
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
      throw new Error('Meta did not return a message id for the outbound reply.');
    }

    await markReplySent(data, metaMessageId);
    console.log(`💬 OUTBOUND: ${data.messageType} reply sent to ${data.subscriberPhone}`);
  } catch (error: any) {
    console.error(`❌ Meta API Error (Agent Reply Org: ${data.orgId}):`, error.response?.data || error.message);

    if (error.response?.data?.error) {
      await markReplyFailed(
        data.messageId,
        `${data.messageType} reply failed for ${data.subscriberPhone} (Meta Error: ${error.response.data.error.code})`,
        String(error.response.data.error.code)
      );
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
    if (isFinalAttempt) {
      await markReplyFailed(
        data.messageId,
        `${data.messageType} reply failed for ${data.subscriberPhone}: ${error.message}`
      );
      return;
    }

    throw error;
  }
};

export const startAgentReplyWorker = () =>
  new Worker<AgentReplyJobData>(
    QUEUE_NAMES.agentReplyProcess,
    processAgentReplyJob,
    {
      connection: createWorkerConnection('whatching-agent-reply-worker'),
      concurrency: 10,
    }
  );
