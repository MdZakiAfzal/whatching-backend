import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { config } from '../config';
import { PlanManager } from '../utils/planManager';
import Organization from '../models/Organization';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import Transaction from '../models/Transaction';
import { enqueueTemplateSendJob } from '../queues/templateSendQueue';
import Message from '../models/Message';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { getOrCreateActiveConversation } from '../services/conversationService';
import { logIntegrationAction } from '../services/integrationLogService';
import { upsertSubscriber } from '../services/subscriberService';

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

  const fee = config.meta.templateFee;

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

  const session = await mongoose.startSession();
  let remainingBalance = org.walletBalance;

  try {
    await session.withTransaction(async () => {
      const debitResult = await Organization.findOneAndUpdate(
        {
          _id: org._id,
          walletBalance: { $gte: fee },
        },
        {
          $inc: { walletBalance: -fee },
        },
        {
          session,
          returnDocument: 'after',
        }
      ).select('walletBalance');

      if (!debitResult) {
        throw new AppError(`Insufficient wallet balance. Sending this message costs ₹${fee}.`, 402);
      }

      remainingBalance = debitResult.walletBalance;

      await Transaction.create([{
        orgId: org._id,
        amount: -fee,
        type: 'broadcast_fee',
        status: 'success',
        description: `Template message queued for ${phoneNumber} (${templateName})`,
        referenceId: `template_send:${String(messageId)}`,
      }], { session });

      await Message.create([{
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
      }], { session });
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error('Transaction failed while queueing template message:', error);
    throw new AppError('Financial transaction failed. Message was not queued.', 500);
  } finally {
    await session.endSession();
  }

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
      cost: fee,
      initiatedBy: String(req.user._id),
      traceId,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const refundSession = await mongoose.startSession();

    try {
      await refundSession.withTransaction(async () => {
        const refundResult = await Transaction.updateOne(
          { referenceId: `refund:${String(messageId)}` },
          {
            $setOnInsert: {
              orgId: org._id,
              amount: fee,
              type: 'refund',
              status: 'success',
              description: `Refund for queue failure while sending ${templateName} to ${phoneNumber}`,
              referenceId: `refund:${String(messageId)}`,
            },
          },
          { upsert: true, session: refundSession }
        );

        if (refundResult.upsertedCount > 0) {
          await Organization.findByIdAndUpdate(org._id, {
            $inc: { walletBalance: fee },
          }, { session: refundSession });
        }

        await Message.findOneAndUpdate(
          { _id: messageId, orgId: org._id },
          {
            status: 'failed',
            failedAt: new Date(),
            errorMessage: 'Queueing failed before delivery',
          },
          { session: refundSession }
        );
      });
    } finally {
      await refundSession.endSession();
    }

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

    throw new AppError('Message could not be queued right now. Your wallet has been refunded.', 503);
  }

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
      cost: fee,
    },
    externalRef: String(messageId),
  });

  res.status(202).json({
    status: 'success',
    message: 'Message queued for delivery successfully.',
    data: {
      messageId: String(messageId),
      cost: fee,
      remainingBalance,
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
