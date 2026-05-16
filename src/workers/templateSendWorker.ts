import { Job, Worker } from 'bullmq';
import axios from 'axios';
import Organization from '../models/Organization';
import Message from '../models/Message';
import { getOrCreateActiveConversation } from '../services/conversationService';
import { logIntegrationAction } from '../services/integrationLogService';
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

const markMessageFailed = async (
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

const processTemplateSendJob = async (job: Job<TemplateSendJobData>) => {
  const data = job.data;
  const maxAttempts = job.opts.attempts ?? 1;
  const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

  try {
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
    const providerError = error.response?.data?.error;
    const shouldFinalize = Boolean(providerError) || isFinalAttempt;

    if (!shouldFinalize) {
      throw error;
    }

    const failureDescription = providerError
      ? `Meta rejected outbound template send (${providerError.code || 'unknown'}): ${
          providerError.message || 'Unknown Meta error'
        }`
      : `Outbound template send failed: ${error.message}`;

    await markMessageFailed(
      data.messageId,
      failureDescription,
      providerError ? String(providerError.code) : undefined
    );

    await logIntegrationAction({
      orgId: data.orgId,
      actorUserId: data.initiatedBy,
      action: 'template_send_failed',
      status: 'failed',
      details: {
        messageId: data.messageId,
        templateId: data.templateId,
        templateName: data.templateName,
        phoneNumber: data.subscriberPhone,
        reason: failureDescription,
      },
      externalRef: data.messageId,
    });
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
