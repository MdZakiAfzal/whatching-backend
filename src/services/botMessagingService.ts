import axios from 'axios';
import mongoose from 'mongoose';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import { decrypt } from '../utils/encryption';
import { publishConversationUpdated, publishMessageCreated, publishMessageUpdated } from './realtimeService';
import { trackMessagingUsage } from './usageService';

type SendBotMessageInput = {
  organization: any;
  conversation: any;
  subscriber: any;
  type: 'text' | 'image' | 'document' | 'location' | 'interactive';
  source?: 'bot' | 'system';
  payload: Record<string, unknown>;
  previewText: string;
  markAsLastBotMessage?: boolean;
  systemEventType?: string;
};

const createBaseMessage = async ({
  conversation,
  subscriber,
  organization,
  type,
  source,
  payload,
  previewText,
  systemEventType,
  markAsLastBotMessage,
}: SendBotMessageInput) => {
  const message = await Message.create({
    orgId: organization._id,
    conversationId: conversation._id,
    subscriberId: subscriber._id,
    direction: source === 'system' ? 'system' : 'outbound',
    source: source || 'bot',
    type: source === 'system' ? 'system' : type,
    status: source === 'system' ? 'sent' : 'queued',
    payload: {
      ...payload,
      ...(source === 'system'
        ? {
            systemEventType: systemEventType || 'system_event',
            systemMessage: previewText,
            text: previewText,
          }
        : {}),
    },
  });

  await Conversation.findByIdAndUpdate(conversation._id, {
    $set: {
      lastMessage: previewText,
      lastMessageAt: new Date(),
      lastOutboundAt: new Date(),
      ...(source === 'bot' && markAsLastBotMessage ? { lastBotMessageId: message._id } : {}),
    },
  });

  await publishMessageCreated(String(organization._id), String(conversation._id), String(message._id));
  await publishConversationUpdated(String(organization._id), String(conversation._id));

  return message;
};

export const createSystemConversationMessage = async ({
  organization,
  conversation,
  subscriber,
  previewText,
  systemEventType,
  payload = {},
}: {
  organization: any;
  conversation: any;
  subscriber: any;
  previewText: string;
  systemEventType: string;
  payload?: Record<string, unknown>;
}) =>
  createBaseMessage({
    organization,
    conversation,
    subscriber,
    type: 'text',
    source: 'system',
    payload,
    previewText,
    systemEventType,
  });

export const sendBotMetaMessage = async ({
  organization,
  conversation,
  subscriber,
  type,
  payload,
  previewText,
  markAsLastBotMessage = true,
}: SendBotMessageInput) => {
  if (!organization?.metaConfig?.accessToken || !organization?.metaConfig?.phoneNumberId) {
    throw new Error('Organization Meta configuration is incomplete.');
  }

  const queuedMessage = await createBaseMessage({
    organization,
    conversation,
    subscriber,
    type,
    source: 'bot',
    payload,
    previewText,
    markAsLastBotMessage,
  });

  const requestPayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: subscriber.phoneNumber,
    ...payload,
  };

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${organization.metaConfig.phoneNumberId}/messages`,
      requestPayload,
      {
        headers: {
          Authorization: `Bearer ${decrypt(organization.metaConfig.accessToken)}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const metaMessageId = response.data.messages?.[0]?.id;
    console.log('✅ Meta bot message sent:', {
      orgId: String(organization._id),
      conversationId: String(conversation._id),
      localMessageId: String(queuedMessage._id),
      metaMessageId,
      type,
      interactiveType:
        typeof payload.interactive === 'object' && payload.interactive
          ? (payload.interactive as any).type
          : undefined,
    });

    await Message.findByIdAndUpdate(queuedMessage._id, {
      status: 'sent',
      sentAt: new Date(),
      metaMessageId,
      errorCode: undefined,
      errorMessage: undefined,
      failedAt: undefined,
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
      $set: {
        lastOutboundMetaMessageId: metaMessageId,
        ...(markAsLastBotMessage ? { lastBotMessageId: queuedMessage._id } : {}),
      },
    });

    await trackMessagingUsage(organization._id, 'sessionMessagesSent');
    await publishMessageUpdated(
      String(organization._id),
      String(conversation._id),
      String(queuedMessage._id)
    );
    await publishConversationUpdated(String(organization._id), String(conversation._id));

    return {
      messageId: String(queuedMessage._id),
      metaMessageId,
    };
  } catch (error: any) {
    const providerError = error.response?.data?.error;
    if (providerError) {
      console.error('Meta bot message error:', {
        code: providerError.code,
        subcode: providerError.error_subcode,
        type: providerError.type,
        message: providerError.message,
        details: providerError.error_data?.details,
        fbtraceId: providerError.fbtrace_id,
      });
    }

    await Message.findByIdAndUpdate(queuedMessage._id, {
      status: 'failed',
      failedAt: new Date(),
      errorCode: error.response?.data?.error?.code
        ? String(error.response.data.error.code)
        : undefined,
      errorMessage:
        error.response?.data?.error?.message || error.message || 'Bot message failed',
    });

    await publishMessageUpdated(
      String(organization._id),
      String(conversation._id),
      String(queuedMessage._id)
    );

    throw error;
  }
};

export const buildReplyContextPayload = (message: any) => {
  if (!message) {
    return undefined;
  }

  return {
    metaMessageId: message.metaMessageId,
    direction: message.direction,
    source: message.source,
    previewText:
      message.payload?.text ||
      message.payload?.caption ||
      message.payload?.systemMessage ||
      null,
  };
};
