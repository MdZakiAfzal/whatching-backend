import { Job, Worker } from 'bullmq';
import mongoose from 'mongoose';
import WebhookEvent from '../models/WebhookEvent';
import Message from '../models/Message';
import { upsertSubscriber } from '../services/subscriberService';
import { getOrCreateActiveConversation } from '../services/conversationService';
import { QUEUE_NAMES } from '../queues/names';
import { WhatsAppWebhookJobData } from '../queues/whatsappWebhookQueue';
import { createWorkerConnection } from '../queues/redis';
import Organization from '../models/Organization';
import { syncBroadcastRecipientFromMessageStatus } from '../services/broadcastService';
import { persistInboundMetaMedia } from '../services/mediaService';
import { applyTemplateStatusWebhook } from '../services/templateService';
import { applyPhoneNumberQualityWebhook } from '../services/metaOperationalService';

const extractMessageType = (message: any) => {
  const normalizedType = String(message?.type || '').toLowerCase();
  if (['text', 'image', 'audio', 'document', 'video', 'template'].includes(normalizedType)) {
    return normalizedType as 'text' | 'image' | 'audio' | 'document' | 'video' | 'template';
  }

  return 'unknown' as const;
};

const getMessageAsset = (message: any) => {
  const normalizedType = String(message?.type || '').toLowerCase();
  if (!normalizedType || typeof message?.[normalizedType] !== 'object') {
    return null;
  }

  return message[normalizedType];
};

const buildInboundMessagePreview = (message: any) => {
  if (message.type === 'text') {
    return message.text?.body || '';
  }

  const asset = getMessageAsset(message);
  const caption = typeof asset?.caption === 'string' ? asset.caption.trim() : '';
  const filename = typeof asset?.filename === 'string' ? asset.filename.trim() : '';
  const label = String(message.type || 'message')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase());

  if (caption) {
    return caption;
  }

  if (filename) {
    return `[Received ${label}: ${filename}]`;
  }

  return `[Received ${label}]`;
};

const resolveInboundMessagePayload = (message: any) => {
  const asset = getMessageAsset(message);
  const preview = buildInboundMessagePreview(message);

  if (message.type === 'text') {
    return {
      text: preview,
    };
  }

  return {
    text: preview,
    ...(asset?.id ? { mediaId: asset.id } : {}),
    ...(asset?.caption ? { caption: asset.caption } : {}),
    ...(asset?.filename ? { filename: asset.filename } : {}),
    ...(asset?.mime_type ? { mimeType: asset.mime_type } : {}),
    ...(asset?.sha256 ? { sha256: asset.sha256 } : {}),
    storageStatus: asset?.id ? 'pending' : undefined,
  };
};

const resolveOrganizationForChange = async ({
  orgId,
  entry,
  value,
}: {
  orgId?: mongoose.Types.ObjectId | string;
  entry: any;
  value: any;
}) => {
  if (orgId) {
    return Organization.findById(orgId).select('+metaConfig.accessToken');
  }

  const phoneNumberId = value?.metadata?.phone_number_id;
  if (phoneNumberId) {
    const organization = await Organization.findOne({
      'metaConfig.phoneNumberId': phoneNumberId,
    }).select('+metaConfig.accessToken');
    if (organization) {
      return organization;
    }
  }

  if (entry?.id) {
    return Organization.findOne({
      'metaConfig.wabaId': String(entry.id),
    }).select('+metaConfig.accessToken');
  }

  return null;
};

const updateMessageStatus = async (
  orgId: string,
  statusPayload: any
) => {
  const update: Record<string, unknown> = {};
  const normalizedStatus = String(statusPayload.status || '').toLowerCase();
  const eventTimestamp = statusPayload.timestamp
    ? new Date(Number(statusPayload.timestamp) * 1000)
    : new Date();

  if (normalizedStatus === 'delivered') {
    update.status = 'delivered';
    update.deliveredAt = eventTimestamp;
  } else if (normalizedStatus === 'read') {
    update.status = 'read';
    update.readAt = eventTimestamp;
  } else if (normalizedStatus === 'failed') {
    update.status = 'failed';
    update.failedAt = eventTimestamp;
    update.errorCode = statusPayload.errors?.[0]?.code ? String(statusPayload.errors[0].code) : undefined;
    update.errorMessage = statusPayload.errors?.[0]?.title || statusPayload.errors?.[0]?.message;
  } else if (normalizedStatus === 'sent') {
    update.status = 'sent';
    update.sentAt = eventTimestamp;
  } else {
    return;
  }

  const message = await Message.findOneAndUpdate(
    {
      orgId,
      metaMessageId: statusPayload.id,
    },
    update,
    {
      returnDocument: 'after',
    }
  );

  if (!message) {
    return;
  }

  await syncBroadcastRecipientFromMessageStatus({
    orgId,
    messageId: message._id,
    metaMessageId: statusPayload.id,
    normalizedStatus,
    eventTimestamp,
    errorCode: statusPayload.errors?.[0]?.code ? String(statusPayload.errors[0].code) : undefined,
    errorMessage: statusPayload.errors?.[0]?.title || statusPayload.errors?.[0]?.message,
  });
};

const processInboundMessage = async (organization: any, value: any, message: any) => {
  const orgId = organization._id;
  const phoneNumber = message.from;
  const matchedContact =
    value.contacts?.find((contact: any) => String(contact.wa_id || contact.input) === String(phoneNumber)) ||
    value.contacts?.[0];
  const profileName = matchedContact?.profile?.name;
  const existingMessage = await Message.findOne({
    orgId,
    metaMessageId: message.id,
  }).select('_id payload type');

  const inboundPayload = resolveInboundMessagePayload(message);
  const normalizedType = extractMessageType(message);

  let subscriber = null;
  let conversation = null;

  if (!existingMessage) {
    subscriber = await upsertSubscriber(orgId, phoneNumber, profileName, {
      waId: matchedContact?.wa_id,
      direction: 'inbound',
      optInSource: 'whatsapp_inbound',
    });

    conversation = await getOrCreateActiveConversation(
      orgId,
      subscriber._id as any,
      inboundPayload.text || '',
      'inbound'
    );

    await Message.create({
      orgId,
      conversationId: (conversation as any)._id,
      subscriberId: subscriber._id,
      direction: 'inbound',
      type: normalizedType,
      metaMessageId: message.id,
      status: 'received',
      payload: inboundPayload,
      sentAt: message.timestamp ? new Date(parseInt(message.timestamp, 10) * 1000) : new Date(),
    });
  } else {
    subscriber = await upsertSubscriber(orgId, phoneNumber, profileName, {
      waId: matchedContact?.wa_id,
      direction: 'inbound',
      optInSource: 'whatsapp_inbound',
    });
  }

  const mediaAsset = getMessageAsset(message);
  const mediaId = typeof mediaAsset?.id === 'string' ? mediaAsset.id : undefined;

  if (
    mediaId &&
    organization.metaConfig?.accessToken &&
    normalizedType !== 'text' &&
    (!existingMessage || existingMessage.payload?.storageStatus !== 'stored')
  ) {
    try {
      const persistedMedia = await persistInboundMetaMedia({
        orgId: String(orgId),
        encryptedAccessToken: organization.metaConfig.accessToken,
        phoneNumberId: organization.metaConfig.phoneNumberId,
        mediaId,
        messageType: normalizedType,
        originalFilename: mediaAsset?.filename,
      });

      await Message.findOneAndUpdate(
        {
          orgId,
          metaMessageId: message.id,
        },
        {
          $set: {
            payload: {
              ...inboundPayload,
              ...persistedMedia,
              storageStatus: 'stored',
            },
          },
        }
      );
    } catch (error: any) {
      await Message.findOneAndUpdate(
        {
          orgId,
          metaMessageId: message.id,
        },
        {
          $set: {
            payload: {
              ...inboundPayload,
              storageStatus: 'failed',
              mediaDownloadError: error.message,
            },
          },
        }
      );
      console.error(`⚠️ Failed to persist inbound media for org ${String(orgId)}:`, error.message);
    }
  }

  console.log(`✅ INBOX: Message from ${profileName || phoneNumber}: "${inboundPayload.text}"`);
};

const markWebhookProcessed = async (webhookEventId: string) => {
  await WebhookEvent.findByIdAndUpdate(webhookEventId, {
    processingStatus: 'processed',
    processedAt: new Date(),
    $inc: { processingAttempts: 1 },
    $unset: { error: 1 },
  });
};

const markWebhookFailed = async (webhookEventId: string, error: unknown) => {
  await WebhookEvent.findByIdAndUpdate(webhookEventId, {
    processingStatus: 'failed',
    $inc: { processingAttempts: 1 },
    error: error instanceof Error ? error.message : 'Unknown worker error',
  });
};

const processWhatsAppWebhookJob = async (job: Job<WhatsAppWebhookJobData>) => {
  const webhookEvent = await WebhookEvent.findById(job.data.webhookEventId);
  if (!webhookEvent || webhookEvent.processingStatus === 'processed') return;

  await WebhookEvent.findByIdAndUpdate(webhookEvent._id, { processingStatus: 'processing' });

  try {
    const payload = webhookEvent.payload;

    if (payload?.object === 'whatsapp_business_account') {
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change?.value;
          const organization = await resolveOrganizationForChange({
            orgId: webhookEvent.orgId,
            entry,
            value,
          });

          if (!organization) {
            continue;
          }

          if (!webhookEvent.orgId) {
            webhookEvent.orgId = organization._id;
            await webhookEvent.save();
          }

          await Organization.findByIdAndUpdate(
            organization._id,
            {
              $set: {
                'metaConfig.webhookVerifiedAt': new Date(),
                'metaConfig.lastHealthCheckAt': new Date(),
              },
            }
          );

          if (change?.field === 'messages') {
            for (const message of value?.messages ?? []) {
              await processInboundMessage(organization, value, message);
            }

            for (const statusPayload of value?.statuses ?? []) {
              await updateMessageStatus(String(organization._id), statusPayload);
            }
          }

          if (change?.field === 'message_template_status_update') {
            await applyTemplateStatusWebhook({
              orgId: String(organization._id),
              wabaId: organization.metaConfig?.wabaId,
              value,
            });
          }

          if (change?.field === 'phone_number_quality_update') {
            await applyPhoneNumberQualityWebhook({
              organization,
              event: value?.event,
              currentLimit: value?.current_limit,
            });
          }
        }
      }
    }

    await markWebhookProcessed(String(webhookEvent._id));
  } catch (error) {
    await markWebhookFailed(String(webhookEvent._id), error);
    throw error;
  }
};

export const startWhatsAppWebhookWorker = () =>
  new Worker<WhatsAppWebhookJobData>(
    QUEUE_NAMES.whatsappWebhookProcess,
    processWhatsAppWebhookJob,
    {
      connection: createWorkerConnection('whatching-whatsapp-worker'),
      concurrency: 5,
    }
  );
