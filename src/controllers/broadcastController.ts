import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Broadcast from '../models/Broadcast';
import BroadcastRecipient from '../models/BroadcastRecipient';
import Subscriber from '../models/Subscriber';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import Organization from '../models/Organization';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { PlanManager } from '../utils/planManager';
import {
  buildBroadcastAudienceFilter,
  countBroadcastAudience,
} from '../services/broadcastService';
import {
  enqueueBroadcastStartJob,
  removeScheduledBroadcastStartJob,
} from '../queues/broadcastFanoutQueue';
import { logIntegrationAction } from '../services/integrationLogService';

const TERMINAL_STATUSES = new Set(['completed', 'canceled', 'failed']);

type NormalizedAudience = {
  mode: 'all' | 'tags' | 'specific';
  tags: string[];
  tagMatch: 'any' | 'all';
  subscriberIds: mongoose.Types.ObjectId[];
  optedInOnly: boolean;
};

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || '20'), 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const normalizeAudience = (audience: any): NormalizedAudience => {
  const mode = audience?.mode;
  const optedInOnly = audience?.optedInOnly !== false;

  if (mode === 'tags') {
    return {
      mode,
      tags: Array.from(
        new Set<string>(
          (Array.isArray(audience?.tags) ? audience.tags : [])
            .map((tag: unknown) => String(tag).trim())
            .filter(Boolean)
        )
      ),
      tagMatch: audience?.tagMatch === 'all' ? 'all' : 'any',
      subscriberIds: [] as mongoose.Types.ObjectId[],
      optedInOnly,
    };
  }

  if (mode === 'specific') {
    return {
      mode,
      tags: [] as string[],
      tagMatch: 'any' as const,
      subscriberIds: Array.from(
        new Set<string>(
          (Array.isArray(audience?.subscriberIds) ? audience.subscriberIds : []).map((subscriberId: string) =>
            String(subscriberId)
          )
        )
      ).map((subscriberId) => new mongoose.Types.ObjectId(subscriberId)),
      optedInOnly,
    };
  }

  return {
    mode: 'all' as const,
    tags: [] as string[],
    tagMatch: 'any' as const,
    subscriberIds: [] as mongoose.Types.ObjectId[],
    optedInOnly,
  };
};

export const createBroadcast = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const plan = new PlanManager(req.org);
  if (!plan.canUse('bulkMessaging')) {
    return next(new AppError('Your current plan does not support broadcasts. Please upgrade.', 403));
  }

  const org = await Organization.findById(req.org._id);
  if (!org?.metaConfig?.status || org.metaConfig.status !== 'ready') {
    return next(new AppError('Your Meta integration is not ready. Please connect your account.', 400));
  }

  const template = await WhatsAppTemplate.findOne({
    orgId: req.org._id,
    templateId: req.body.templateId,
  });

  if (!template) {
    return next(new AppError('Template not found for this organization.', 404));
  }

  if (template.status !== 'APPROVED') {
    return next(new AppError(`Cannot use template '${template.name}' because its status is ${template.status}.`, 400));
  }

  const audience = normalizeAudience(req.body.audience);
  const estimatedRecipients = await countBroadcastAudience(Subscriber, req.org._id, audience);

  const broadcast = (await Broadcast.create({
    orgId: req.org._id,
    createdBy: req.user._id,
    name: req.body.name.trim(),
    template: {
      templateId: template.templateId,
      name: template.name,
      language: template.language,
      category: template.category,
    },
    payload: {
      components: Array.isArray(req.body.components) ? req.body.components : [],
    },
    audience,
  })) as any;

  await logIntegrationAction({
    orgId: req.org._id,
    actorUserId: req.user._id,
    action: 'broadcast_create',
    status: 'success',
    details: {
      broadcastId: String(broadcast._id),
      templateId: template.templateId,
      estimatedRecipients,
    },
    externalRef: String(broadcast._id),
  });

  res.status(201).json({
    status: 'success',
    data: {
      broadcast,
      estimatedRecipients,
    },
  });
});

export const listBroadcasts = catchAsync(async (req: any, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter: Record<string, unknown> = { orgId: req.org._id };

  if (typeof req.query.status === 'string' && req.query.status.trim()) {
    filter.status = req.query.status.trim();
  }

  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    filter.name = new RegExp(req.query.q.trim(), 'i');
  }

  const [broadcasts, total] = await Promise.all([
    Broadcast.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('startedBy', 'name email'),
    Broadcast.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    results: broadcasts.length,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    data: {
      broadcasts,
    },
  });
});

export const getBroadcast = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { page, limit, skip } = parsePagination(req.query);
  const recipientsFilter: Record<string, unknown> = {
    orgId: req.org._id,
    broadcastId: req.params.broadcastId,
  };

  if (typeof req.query.recipientStatus === 'string' && req.query.recipientStatus.trim()) {
    recipientsFilter.status = req.query.recipientStatus.trim();
  }

  const broadcast = await Broadcast.findOne({
    _id: req.params.broadcastId,
    orgId: req.org._id,
  })
    .populate('createdBy', 'name email')
    .populate('startedBy', 'name email');

  if (!broadcast) {
    return next(new AppError('Broadcast not found for this organization.', 404));
  }

  const [recipients, recipientsTotal] = await Promise.all([
    BroadcastRecipient.find(recipientsFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('subscriberId', 'phoneNumber firstName lastName tags isOptedIn')
      .populate('messageId', 'status metaMessageId sentAt deliveredAt readAt failedAt errorCode errorMessage'),
    BroadcastRecipient.countDocuments(recipientsFilter),
  ]);

  const estimatedRecipients =
    (broadcast.status === 'draft' || broadcast.status === 'scheduled') && broadcast.stats.totalRecipients === 0
      ? await countBroadcastAudience(Subscriber, req.org._id, broadcast.audience as any)
      : null;

  res.status(200).json({
    status: 'success',
    data: {
      broadcast,
      estimatedRecipients,
      recipients,
      recipientsPagination: {
        page,
        limit,
        total: recipientsTotal,
        totalPages: Math.max(1, Math.ceil(recipientsTotal / limit)),
      },
    },
  });
});

export const startBroadcast = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const plan = new PlanManager(req.org);
  if (!plan.canUse('bulkMessaging')) {
    return next(new AppError('Your current plan does not support broadcasts. Please upgrade.', 403));
  }

  if (
    req.org.metaConfig?.status !== 'ready' ||
    !req.org.metaConfig?.wabaId ||
    !req.org.metaConfig?.phoneNumberId
  ) {
    return next(new AppError('Your Meta integration is not ready. Please connect your account.', 400));
  }

  const broadcast = await Broadcast.findOne({
    _id: req.params.broadcastId,
    orgId: req.org._id,
  });

  if (!broadcast) {
    return next(new AppError('Broadcast not found for this organization.', 404));
  }

  if (broadcast.status !== 'draft') {
    return next(new AppError(`Only draft broadcasts can be started. Current status is ${broadcast.status}.`, 409));
  }

  const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
  if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
    return next(new AppError('scheduledAt must be in the future. Omit it to start immediately.', 400));
  }

  const nextStatus = scheduledAt ? 'scheduled' : 'processing';

  const claimedBroadcast = await Broadcast.findOneAndUpdate(
    {
      _id: broadcast._id,
      orgId: req.org._id,
      status: 'draft',
    },
    {
      $set: {
        status: nextStatus,
        startedBy: req.user._id,
        ...(scheduledAt ? { scheduledAt } : {}),
      },
      $unset: {
        canceledAt: 1,
        completedAt: 1,
        lastError: 1,
        ...(scheduledAt ? {} : { scheduledAt: 1 }),
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    }
  );

  if (!claimedBroadcast) {
    return next(new AppError('This broadcast could not be started because its state changed. Please refresh and try again.', 409));
  }

  const traceId = `broadcast_${String(req.org._id)}_${String(claimedBroadcast._id)}`;

  try {
    await enqueueBroadcastStartJob(
      {
        broadcastId: String(claimedBroadcast._id),
        orgId: String(req.org._id),
        initiatedBy: String(req.user._id),
        traceId,
        createdAt: new Date().toISOString(),
      },
      scheduledAt
        ? {
            delay: Math.max(0, scheduledAt.getTime() - Date.now()),
          }
        : undefined
    );
  } catch (error) {
    await Broadcast.findByIdAndUpdate(claimedBroadcast._id, {
      $set: {
        status: 'draft',
      },
      $unset: {
        scheduledAt: 1,
        startedBy: 1,
      },
    });

    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: scheduledAt ? 'broadcast_schedule_failed' : 'broadcast_start_failed',
      status: 'failed',
      details: {
        broadcastId: String(claimedBroadcast._id),
        reason: error instanceof Error ? error.message : 'Unknown queue error',
      },
      externalRef: String(claimedBroadcast._id),
    });

    return next(new AppError('Broadcast could not be queued right now. Please try again.', 503));
  }

  await logIntegrationAction({
    orgId: req.org._id,
    actorUserId: req.user._id,
    action: scheduledAt ? 'broadcast_scheduled' : 'broadcast_started',
    status: 'success',
    details: {
      broadcastId: String(claimedBroadcast._id),
      scheduledAt: scheduledAt?.toISOString(),
    },
    externalRef: String(claimedBroadcast._id),
  });

  res.status(202).json({
    status: 'success',
    message: scheduledAt
      ? 'Broadcast scheduled successfully.'
      : 'Broadcast accepted for processing.',
    data: {
      broadcastId: String(claimedBroadcast._id),
      status: claimedBroadcast.status,
      scheduledAt: claimedBroadcast.scheduledAt || null,
    },
  });
});

export const cancelBroadcast = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const broadcast = await Broadcast.findOne({
    _id: req.params.broadcastId,
    orgId: req.org._id,
  });

  if (!broadcast) {
    return next(new AppError('Broadcast not found for this organization.', 404));
  }

  if (TERMINAL_STATUSES.has(broadcast.status)) {
    return next(new AppError(`Broadcast is already ${broadcast.status} and cannot be canceled.`, 409));
  }

  const canceledAt = new Date();

  const counts = await BroadcastRecipient.aggregate([
    {
      $match: {
        orgId: req.org._id,
        broadcastId: new mongoose.Types.ObjectId(req.params.broadcastId),
        status: { $in: ['pending', 'queued'] },
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  const queuedCount = counts.find((item) => item._id === 'queued')?.count || 0;
  const pendingCount = counts.find((item) => item._id === 'pending')?.count || 0;
  const canceledCount = queuedCount + pendingCount;

  await Promise.all([
    Broadcast.findByIdAndUpdate(broadcast._id, {
      $set: {
        status: 'canceled',
        canceledAt,
      },
      ...(canceledCount > 0
        ? {
            $inc: {
              'stats.queuedRecipients': -queuedCount,
              'stats.canceledRecipients': canceledCount,
            },
          }
        : {}),
    }),
    BroadcastRecipient.updateMany(
      {
        orgId: req.org._id,
        broadcastId: broadcast._id,
        status: { $in: ['pending', 'queued'] },
      },
      {
        $set: {
          status: 'canceled',
          canceledAt,
          errorMessage: 'Broadcast was canceled before delivery.',
        },
      }
    ),
  ]);

  if (broadcast.status === 'scheduled') {
    await removeScheduledBroadcastStartJob(String(broadcast._id));
  }

  await logIntegrationAction({
    orgId: req.org._id,
    actorUserId: req.user._id,
    action: 'broadcast_canceled',
    status: 'success',
    details: {
      broadcastId: String(broadcast._id),
      canceledRecipients: canceledCount,
    },
    externalRef: String(broadcast._id),
  });

  res.status(200).json({
    status: 'success',
    message: 'Broadcast canceled successfully.',
    data: {
      broadcastId: String(broadcast._id),
      canceledRecipients: canceledCount,
    },
  });
});
