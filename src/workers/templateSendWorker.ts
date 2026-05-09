import { Job, Worker } from 'bullmq';
import axios from 'axios';
import mongoose from 'mongoose';
import Organization from '../models/Organization';
import Message from '../models/Message';
import Transaction from '../models/Transaction';
import { config } from '../config';
import { getOrCreateActiveConversation } from '../services/conversationService';
import { QUEUE_NAMES } from '../queues/names';
import { TemplateSendJobData } from '../queues/templateSendQueue';
import { createWorkerConnection } from '../queues/redis';
import { decrypt } from '../utils/encryption';

const markMessageSent = async (
  messageId: string,
  metaMessageId: string,
  templateName: string,
  subscriberPhone: string
) => {
  await Message.findByIdAndUpdate(messageId, {
    metaMessageId,
    status: 'sent',
    sentAt: new Date(),
    errorCode: undefined,
    errorMessage: undefined,
    failedAt: undefined,
    payload: { text: `[Template: ${templateName}]`, to: subscriberPhone },
  });
};

const markMessageFailedAndRefund = async (
  messageId: string,
  orgId: string,
  subscriberPhone: string,
  amount: number,
  description: string,
  errorCode?: string
) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Message.findByIdAndUpdate(
        messageId,
        {
          status: 'failed',
          failedAt: new Date(),
          errorCode,
          errorMessage: description,
        },
        { session }
      );

      const refundReferenceId = `refund:${messageId}`;
      const refundResult = await Transaction.updateOne(
        { referenceId: refundReferenceId },
        {
          $setOnInsert: {
            orgId,
            amount,
            type: 'refund',
            status: 'success',
            description,
            referenceId: refundReferenceId,
          },
        },
        { upsert: true, session }
      );

      if (refundResult.upsertedCount > 0) {
        await Organization.findByIdAndUpdate(
          orgId,
          { $inc: { walletBalance: amount } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
};

const processTemplateSendJob = async (job: Job<TemplateSendJobData>) => {
  const data = job.data;

  // 1. Fetch Organization & Decrypt Token
  const org = await Organization.findById(data.orgId).select('+metaConfig.accessToken');
  if (!org?.metaConfig?.accessToken) {
    throw new Error(`Missing access token for org: ${data.orgId}`);
  }
  const token = decrypt(org.metaConfig.accessToken);

  // 2. Construct Meta Graph API Payload
  const payload = {
    messaging_product: 'whatsapp',
    to: data.subscriberPhone,
    type: 'template',
    template: {
      name: data.templateName,
      language: { code: data.languageCode },
      components: data.components || []
    }
  };

  try {
    // 3. Fire to Meta
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${data.phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const metaMessageId = response.data.messages?.[0]?.id;

    if (metaMessageId) {
      await getOrCreateActiveConversation(
        data.orgId as any,
        data.subscriberId as any,
        `[Template Sent: ${data.templateName}]`
      );
      await markMessageSent(data.messageId, metaMessageId, data.templateName, data.subscriberPhone);
      console.log(`🚀 OUTBOUND: Template '${data.templateName}' sent to ${data.subscriberPhone}`);
      return;
    }

    throw new Error('Meta did not return a message id for the outbound template send.');
  } catch (error: any) {
    console.error(`❌ Meta API Error (Org: ${data.orgId}):`, error.response?.data || error.message);

    if (error.response?.data?.error) {
      await markMessageFailedAndRefund(
        data.messageId,
        data.orgId,
        data.subscriberPhone,
        data.cost,
        `Refund for failed delivery to ${data.subscriberPhone} (Meta Error: ${error.response.data.error.code})`,
        String(error.response.data.error.code)
      );
      console.log(`💰 Refunded ₹${data.cost} to Org ${data.orgId} due to Meta rejection.`);
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    if (isFinalAttempt) {
      await markMessageFailedAndRefund(
        data.messageId,
        data.orgId,
        data.subscriberPhone,
        data.cost,
        `Refund for delivery failure to ${data.subscriberPhone}: ${error.message}`
      );
      console.log(`💰 Refunded ₹${data.cost} to Org ${data.orgId} after final retry failure.`);
      return;
    }

    throw error;
  }
};

export const startTemplateSendWorker = () =>
  new Worker<TemplateSendJobData>(
    QUEUE_NAMES.templateSendProcess,
    processTemplateSendJob,
    {
      connection: createWorkerConnection('whatching-template-worker'),
      concurrency: 10, // Can process 10 outbound messages simultaneously
    }
  );
