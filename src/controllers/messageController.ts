import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { PlanManager } from '../utils/planManager';
import Organization from '../models/Organization';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import { enqueueTemplateSendJob } from '../queues/templateSendQueue';
import { enqueueAgentReplyJob, AgentReplyMessageType } from '../queues/agentReplyQueue';
import Message from '../models/Message';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { getOrCreateActiveConversation } from '../services/conversationService';
import { logIntegrationAction } from '../services/integrationLogService';
import { upsertSubscriber } from '../services/subscriberService';
import Conversation from '../models/Conversation';
import Subscriber from '../models/Subscriber';
import { getMessagingBillingState } from '../utils/messagingBilling';
import { trackMessagingUsage } from '../services/usageService';
import { uploadAgentReplyAttachment } from '../services/mediaService';
import { sanitizeMetaTemplateComponents } from '../services/broadcastPersonalizationService';

type UploadedAttachment = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

const deriveAttachmentMessageType = (
  file: UploadedAttachment,
  requestedType?: string
): AgentReplyMessageType => {
  if (requestedType && ['image', 'document', 'audio', 'video'].includes(requestedType)) {
    return requestedType as AgentReplyMessageType;
  }

  if (file.mimetype.startsWith('image/')) {
    return 'image';
  }

  if (file.mimetype.startsWith('audio/')) {
    return 'audio';
  }

  if (file.mimetype.startsWith('video/')) {
    return 'video';
  }

  return 'document';
};

const buildReplyPreviewText = ({
  messageType,
  text,
  caption,
  filename,
}: {
  messageType: AgentReplyMessageType;
  text?: string;
  caption?: string;
  filename?: string;
}) => {
  if (messageType === 'text') {
    return text || '[Empty Reply]';
  }

  const typeLabel = messageType.charAt(0).toUpperCase() + messageType.slice(1);
  if (caption) {
    return caption;
  }

  if (filename) {
    return `[${typeLabel}: ${filename}]`;
  }

  return `[${typeLabel} Reply]`;
};

export const sendTemplateMessage = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { phoneNumber, templateName, languageCode = 'en_US', components = [] } = req.body;
  const org = req.org;
  const metaSafeComponents = sanitizeMetaTemplateComponents(
    Array.isArray(components) ? components : []
  );

  // 1. PLAN VERIFICATION: Ensure the business has outbound messaging rights
  const plan = new PlanManager(org);
  if (!plan.canUse('bulkMessaging')) {
    return next(new AppError('Your current plan does not support outbound template messaging. Please upgrade.', 403));
  }

  // 2. Validate Integration Status
  if (org.metaConfig?.status !== 'ready' || !org.metaConfig.wabaId || !org.metaConfig.phoneNumberId) {
    return next(new AppError('Your Meta integration is not ready. Please connect your account.', 400));
  }

  // 3. Validate Template
  const template = await WhatsAppTemplate.findOne({ 
    orgId: org._id, 
    name: templateName,
    language: languageCode 
  });

  if (!template) {
    return next(new AppError(`Template '${templateName}' not found in your account. Please sync templates.`, 404));
  }
  if (template.status !== 'APPROVED') {
    return next(new AppError(`Cannot send template '${templateName}' because its status is ${template.status}.`, 400));
  }

  const subscriber = await upsertSubscriber(org._id, phoneNumber, undefined, {
    direction: 'outbound',
    optInSource: 'manual',
  });

  const conversation = await getOrCreateActiveConversation(
    org._id,
    subscriber._id as any,
    `[Queued Template: ${template.name}]`
  );

  const messageId = new mongoose.Types.ObjectId();
  const traceId = `tplsend_${String(org._id)}_${String(messageId)}`;

  await Message.create({
    _id: messageId,
    orgId: org._id,
    conversationId: (conversation as any)._id,
    subscriberId: subscriber._id,
    direction: 'outbound',
    type: 'template',
    templateId: template.templateId,
    status: 'queued',
    payload: {
      text: `[Template: ${template.name}]`,
      components: metaSafeComponents,
    },
  });

  try {
    await enqueueTemplateSendJob({
      messageId: String(messageId),
      orgId: String(org._id),
      wabaId: org.metaConfig.wabaId,
      phoneNumberId: org.metaConfig.phoneNumberId,
      subscriberId: String(subscriber._id),
      subscriberPhone: phoneNumber,
      templateName,
      templateId: template.templateId,
      languageCode,
      components: metaSafeComponents,
      initiatedBy: String(req.user._id),
      traceId,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    await Message.findOneAndUpdate(
      { _id: messageId, orgId: org._id },
      {
        status: 'failed',
        failedAt: new Date(),
        errorMessage: 'Queueing failed before delivery',
      }
    );

    await logIntegrationAction({
      orgId: org._id,
      actorUserId: req.user._id,
      action: 'template_send_queue_failed',
      status: 'failed',
      details: {
        messageId: String(messageId),
        templateName,
        phoneNumber,
      },
      externalRef: String(messageId),
    });

    throw new AppError('Message could not be queued right now. Please try again.', 503);
  }

  await trackMessagingUsage(org._id, 'templateMessagesSent');

  await logIntegrationAction({
    orgId: org._id,
    actorUserId: req.user._id,
    action: 'template_send_queued',
    status: 'success',
    details: {
      messageId: String(messageId),
      templateId: template.templateId,
      templateName,
      phoneNumber,
      billingMode: getMessagingBillingState(org).mode,
    },
    externalRef: String(messageId),
  });

  res.status(202).json({
    status: 'success',
    message: 'Message queued for delivery successfully.',
    data: {
      messageId: String(messageId),
      queueStatus: 'queued',
      billingMode: getMessagingBillingState(org).mode,
    }
  });
});

export const getMessage = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const message = await Message.findOne({
    _id: req.params.messageId,
    orgId: req.org._id,
  })
    .populate('subscriberId', 'phoneNumber firstName lastName')
    .populate('conversationId', 'status assignedTo lastMessage updatedAt');

  if (!message) {
    return next(new AppError('Message not found for this organization.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { message },
  });
});

export const sendAgentReply = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const rawCaption = typeof req.body.caption === 'string' ? req.body.caption.trim() : '';
  const uploadedFile = req.file as UploadedAttachment | undefined;
  const org = req.org;

  if (org.metaConfig?.status !== 'ready' || !org.metaConfig.phoneNumberId) {
    return next(new AppError('Your Meta integration is not ready. Please connect your account.', 400));
  }

  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    orgId: org._id,
  });

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  const subscriber = await Subscriber.findOne({
    _id: conversation.subscriberId,
    orgId: org._id,
  });

  if (!subscriber) {
    return next(new AppError('Subscriber not found for this conversation.', 404));
  }

  const windowSource = conversation.lastInboundAt || subscriber.lastInboundAt;
  if (!windowSource || Date.now() - new Date(windowSource).getTime() > 24 * 60 * 60 * 1000) {
    return next(
      new AppError(
        'The customer service window has expired. Use an approved template message to re-open the conversation.',
        409
      )
    );
  }

  if (!uploadedFile && !text) {
    return next(new AppError('Reply text is required when no attachment is uploaded.', 400));
  }

  const messageType: AgentReplyMessageType = uploadedFile
    ? deriveAttachmentMessageType(uploadedFile, req.body.messageType)
    : 'text';
  const caption = messageType === 'text' ? '' : rawCaption || text;

  if (messageType === 'text' && !text) {
    return next(new AppError('Reply text is required for text messages.', 400));
  }

  const attachment = uploadedFile
    ? await uploadAgentReplyAttachment({
        orgId: String(org._id),
        buffer: uploadedFile.buffer,
        originalName: uploadedFile.originalname,
        mimeType: uploadedFile.mimetype,
      })
    : undefined;

  const latestInboundMessage = await Message.findOne({
    orgId: org._id,
    conversationId: conversation._id,
    direction: 'inbound',
    metaMessageId: { $exists: true, $ne: null },
  })
    .sort({ createdAt: -1 })
    .select('metaMessageId');

  const messageId = new mongoose.Types.ObjectId();
  const traceId = `reply_${String(org._id)}_${String(messageId)}`;
  const previewText = buildReplyPreviewText({
    messageType,
    text,
    caption,
    filename: attachment?.originalFilename,
  });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Message.create([{
        _id: messageId,
        orgId: org._id,
        conversationId: conversation._id,
        subscriberId: subscriber._id,
        direction: 'outbound',
        type: messageType,
        status: 'queued',
        payload: {
          ...(text ? { text } : {}),
          ...(caption ? { caption } : {}),
          ...(attachment
            ? {
                mediaUrl: attachment.mediaUrl,
                mimeType: attachment.mimeType,
                filename: attachment.originalFilename,
                publicId: attachment.publicId,
              }
            : {}),
        },
      }], { session });

      await Conversation.findByIdAndUpdate(
        conversation._id,
        {
          $set: {
            lastMessage: previewText,
            lastMessageAt: new Date(),
            lastOutboundAt: new Date(),
            status: 'pending',
          },
        },
        { session }
      );

      await Subscriber.findByIdAndUpdate(
        subscriber._id,
        {
          $set: {
            lastInteraction: new Date(),
            lastOutboundAt: new Date(),
          },
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  try {
    await enqueueAgentReplyJob({
      messageId: String(messageId),
      orgId: String(org._id),
      phoneNumberId: org.metaConfig.phoneNumberId,
      subscriberId: String(subscriber._id),
      subscriberPhone: subscriber.phoneNumber,
      messageType,
      ...(messageType === 'text' && text ? { text } : {}),
      ...(caption ? { caption } : {}),
      ...(attachment ? { attachment } : {}),
      initiatedBy: String(req.user._id),
      traceId,
      createdAt: new Date().toISOString(),
      replyToMetaMessageId: latestInboundMessage?.metaMessageId,
    });
  } catch (error) {
    await Message.findByIdAndUpdate(messageId, {
      status: 'failed',
      failedAt: new Date(),
      errorMessage: 'Queueing failed before delivery',
    });

    await logIntegrationAction({
      orgId: org._id,
      actorUserId: req.user._id,
      action: 'agent_reply_queue_failed',
      status: 'failed',
      details: {
        messageId: String(messageId),
        conversationId: String(conversation._id),
        subscriberId: String(subscriber._id),
        messageType,
      },
      externalRef: String(messageId),
    });

    throw new AppError('Reply could not be queued right now. Please try again.', 503);
  }

  await logIntegrationAction({
    orgId: org._id,
    actorUserId: req.user._id,
    action: 'agent_reply_queued',
    status: 'success',
    details: {
      messageId: String(messageId),
      conversationId: String(conversation._id),
      subscriberId: String(subscriber._id),
      messageType,
    },
    externalRef: String(messageId),
  });

  await trackMessagingUsage(org._id, 'sessionMessagesSent');

  res.status(202).json({
    status: 'success',
    message: 'Reply queued for delivery successfully.',
    data: {
      messageId: String(messageId),
      conversationId: String(conversation._id),
      messageType,
    },
  });
});
