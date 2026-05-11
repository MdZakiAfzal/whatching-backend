import { Job, Worker } from 'bullmq';
import axios from 'axios';
import Organization from '../models/Organization';
import Message from '../models/Message';
import { QUEUE_NAMES } from '../queues/names';
import { TextReplyJobData } from '../queues/textReplyQueue';
import { createWorkerConnection } from '../queues/redis';
import { decrypt } from '../utils/encryption';

const markTextMessageSent = async (
  messageId: string,
  metaMessageId: string,
  subscriberPhone: string,
  text: string
) => {
  await Message.findByIdAndUpdate(messageId, {
    metaMessageId,
    status: 'sent',
    sentAt: new Date(),
    errorCode: undefined,
    errorMessage: undefined,
    failedAt: undefined,
    payload: { text, to: subscriberPhone },
  });
};

const markTextMessageFailed = async (
  messageId: string,
  description: string,
  errorCode?: string
) => {
  await Message.findByIdAndUpdate(messageId, {
    status: 'failed',
    failedAt: new Date(),
    errorCode,
    errorMessage: description,
  });
};

const processTextReplyJob = async (job: Job<TextReplyJobData>) => {
  const data = job.data;

  const org = await Organization.findById(data.orgId).select('+metaConfig.accessToken');
  if (!org?.metaConfig?.accessToken) {
    throw new Error(`Missing access token for org: ${data.orgId}`);
  }

  const token = decrypt(org.metaConfig.accessToken);

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: data.subscriberPhone,
    type: 'text',
    text: {
      preview_url: false,
      body: data.text,
    },
  };

  if (data.replyToMetaMessageId) {
    payload.context = {
      message_id: data.replyToMetaMessageId,
    };
  }

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
      throw new Error('Meta did not return a message id for the outbound text reply.');
    }

    await markTextMessageSent(data.messageId, metaMessageId, data.subscriberPhone, data.text);
    console.log(`💬 OUTBOUND: Text reply sent to ${data.subscriberPhone}`);
  } catch (error: any) {
    console.error(`❌ Meta API Error (Text Reply Org: ${data.orgId}):`, error.response?.data || error.message);

    if (error.response?.data?.error) {
      await markTextMessageFailed(
        data.messageId,
        `Text reply failed for ${data.subscriberPhone} (Meta Error: ${error.response.data.error.code})`,
        String(error.response.data.error.code)
      );
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
    if (isFinalAttempt) {
      await markTextMessageFailed(
        data.messageId,
        `Text reply failed for ${data.subscriberPhone}: ${error.message}`
      );
      return;
    }

    throw error;
  }
};

export const startTextReplyWorker = () =>
  new Worker<TextReplyJobData>(
    QUEUE_NAMES.textReplyProcess,
    processTextReplyJob,
    {
      connection: createWorkerConnection('whatching-text-reply-worker'),
      concurrency: 10,
    }
  );
