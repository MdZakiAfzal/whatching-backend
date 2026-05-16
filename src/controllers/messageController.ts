import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { PlanManager } from '../utils/planManager';
import Organization from '../models/Organization';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import { enqueueTemplateSendJob } from '../queues/templateSendQueue';
import { enqueueTextReplyJob } from '../queues/textReplyQueue';
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

export const sendTemplateMessage = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { phoneNumber, templateName, languageCode = 'en_US', components = [] } = req.body;
  const org = req.org;

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
      components,
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
      components,
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

export const sendTextReply = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { text } = req.body;
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

  const latestInboundMessage = await Message.findOne({
    orgId: org._id,
    conversationId: conversation._id,
    direction: 'inbound',
    metaMessageId: { $exists: true, $ne: null },
  })
    .sort({ createdAt: -1 })
    .select('metaMessageId');

  const messageId = new mongoose.Types.ObjectId();
  const traceId = `txtreply_${String(org._id)}_${String(messageId)}`;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Message.create([{
        _id: messageId,
        orgId: org._id,
        conversationId: conversation._id,
        subscriberId: subscriber._id,
        direction: 'outbound',
        type: 'text',
        status: 'queued',
        payload: {
          text,
        },
      }], { session });

      await Conversation.findByIdAndUpdate(
        conversation._id,
        {
          $set: {
            lastMessage: text,
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
    await enqueueTextReplyJob({
      messageId: String(messageId),
      orgId: String(org._id),
      phoneNumberId: org.metaConfig.phoneNumberId,
      subscriberId: String(subscriber._id),
      subscriberPhone: subscriber.phoneNumber,
      text,
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
      action: 'text_reply_queue_failed',
      status: 'failed',
      details: {
        messageId: String(messageId),
        conversationId: String(conversation._id),
        subscriberId: String(subscriber._id),
      },
      externalRef: String(messageId),
    });

    throw new AppError('Reply could not be queued right now. Please try again.', 503);
  }

  await logIntegrationAction({
    orgId: org._id,
    actorUserId: req.user._id,
    action: 'text_reply_queued',
    status: 'success',
    details: {
      messageId: String(messageId),
      conversationId: String(conversation._id),
      subscriberId: String(subscriber._id),
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
    },
  });
});
