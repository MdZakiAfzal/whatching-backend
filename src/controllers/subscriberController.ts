import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Subscriber from '../models/Subscriber';
import Conversation from '../models/Conversation';
import Organization from '../models/Organization';
import catchAsync from '../utils/catchAsync';
import Message from '../models/Message';
import AppError from '../utils/AppError';
import { normalizePhoneNumber } from '../utils/phoneNumber';
import { PlanManager } from '../utils/planManager';

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || '20'), 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const buildReplyWindow = (lastInboundAt?: Date | null) => {
  if (!lastInboundAt) {
    return {
      isOpen: false,
      expiresAt: null,
      remainingMs: 0,
    };
  }

  const expiresAt = new Date(lastInboundAt.getTime() + 24 * 60 * 60 * 1000);
  const remainingMs = Math.max(0, expiresAt.getTime() - Date.now());

  return {
    isOpen: remainingMs > 0,
    expiresAt,
    remainingMs,
  };
};

const chunkArray = <T>(items: T[], chunkSize: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

export const listSubscribers = catchAsync(async (req: any, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter: Record<string, unknown> = { orgId: req.org._id };

  if (typeof req.query.tag === 'string' && req.query.tag.trim().length > 0) {
    filter.tags = req.query.tag.trim();
  }

  if (typeof req.query.optedIn === 'string') {
    filter.isOptedIn = req.query.optedIn === 'true';
  }

  if (typeof req.query.q === 'string' && req.query.q.trim().length > 0) {
    const searchRegex = new RegExp(req.query.q.trim(), 'i');
    filter.$or = [
      { phoneNumber: searchRegex },
      { waId: searchRegex },
      { firstName: searchRegex },
      { lastName: searchRegex },
    ];
  }

  const [subscribers, total, summaryAgg] = await Promise.all([
    Subscriber.find(filter)
      .sort({ lastInteraction: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Subscriber.countDocuments(filter),
    Subscriber.aggregate([
      {
        $match: { orgId: req.org._id },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          optedIn: {
            $sum: { $cond: ['$isOptedIn', 1, 0] },
          },
          optedOut: {
            $sum: { $cond: ['$isOptedIn', 0, 1] },
          },
        },
      },
    ]),
  ]);

  const summary = summaryAgg[0] || {
    total: 0,
    optedIn: 0,
    optedOut: 0,
  };

  res.status(200).json({
    status: 'success',
    results: subscribers.length,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    data: {
      summary,
      subscribers,
    },
  });
});

export const getSubscriber = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const subscriber = await Subscriber.findOne({
    _id: req.params.subscriberId,
    orgId: req.org._id,
  });

  if (!subscriber) {
    return next(new AppError('Subscriber not found for this organization.', 404));
  }

  const conversation = await Conversation.findOne({
    orgId: req.org._id,
    subscriberId: subscriber._id,
  })
    .select('_id status assignedTo lastMessage lastMessageAt lastInboundAt lastOutboundAt unreadCount priority')
    .populate('assignedTo', 'name email phoneNumber');

  res.status(200).json({
    status: 'success',
    data: {
      subscriber,
      conversation: conversation
        ? {
            ...conversation.toObject(),
            replyWindow: buildReplyWindow(conversation.lastInboundAt),
          }
        : null,
    },
  });
});

export const updateSubscriber = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  // 👉 STRIP TAGS: Force the frontend to use our safe attach/detach routes below
  if (req.body.tags !== undefined) {
    delete req.body.tags;
  }
  const subscriber = await Subscriber.findOneAndUpdate(
    {
      _id: req.params.subscriberId,
      orgId: req.org._id,
    },
    {
      $set: req.body,
    },
    {
      returnDocument: 'after',
      runValidators: true,
    }
  );

  if (!subscriber) {
    return next(new AppError('Subscriber not found for this organization.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { subscriber },
  });
});

export const updateSubscriberTags = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const requestedTags = req.body.tags;

  // 1. Fetch the master tag list for this business
  const org = await Organization.findById(req.org._id).select('tags');
  const validTags = new Set(org?.tags || []);

  // 2. Validate that every requested tag exists in the master list
  const invalidTags = requestedTags.filter((tag: string) => !validTags.has(tag));

  if (invalidTags.length > 0) {
    return next(new AppError(`The following tags are unauthorized: ${invalidTags.join(', ')}. Please add them in Organization Settings first.`, 400));
  }

  const subscriber = await Subscriber.findOneAndUpdate(
    {
      _id: req.params.subscriberId,
      orgId: req.org._id,
    },
    {
      $set: { tags: requestedTags },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    }
  );

  if (!subscriber) return next(new AppError('Subscriber not found for this organization.', 404));

  res.status(200).json({ status: 'success', data: { subscriber } });
});

export const importSubscribers = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const payloadRows = Array.isArray(req.body) ? req.body : req.body.subscribers;
  const dryRun = !Array.isArray(req.body) && req.body?.dryRun === true;

  if (!Array.isArray(payloadRows) || payloadRows.length === 0) {
    return next(new AppError('At least one subscriber row is required.', 400));
  }

  const org = await Organization.findById(req.org._id);
  if (!org) {
    return next(new AppError('Organization not found.', 404));
  }

  const plan = new PlanManager(org);
  const dedupedMap = new Map<
    string,
    {
      phoneNumber: string;
      firstName?: string;
      lastName?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
      isOptedIn?: boolean;
      optInSource?: string;
    }
  >();

  const skippedRows: Array<{ phoneNumber?: string; reason: string }> = [];

  for (const row of payloadRows) {
    const normalizedPhoneNumber = normalizePhoneNumber(row.phoneNumber);
    if (!normalizedPhoneNumber || normalizedPhoneNumber.length < 6) {
      skippedRows.push({
        phoneNumber: row.phoneNumber,
        reason: 'invalid_phone_number',
      });
      continue;
    }

    if (dedupedMap.has(normalizedPhoneNumber)) {
      skippedRows.push({
        phoneNumber: normalizedPhoneNumber,
        reason: 'duplicate_in_batch',
      });
      continue;
    }

    dedupedMap.set(normalizedPhoneNumber, {
      phoneNumber: normalizedPhoneNumber,
      firstName: row.firstName?.trim() || undefined,
      lastName: row.lastName?.trim() || undefined,
      ...(Array.isArray(row.tags)
        ? {
            tags: Array.from(new Set(row.tags.map((tag: string) => tag.trim()).filter(Boolean))),
          }
        : {}),
      ...(row.metadata ? { metadata: row.metadata } : {}),
      ...(typeof row.isOptedIn === 'boolean' ? { isOptedIn: row.isOptedIn } : {}),
      ...(row.optInSource?.trim() ? { optInSource: row.optInSource.trim() } : {}),
    });
  }

  const normalizedRows = Array.from(dedupedMap.values());
  if (normalizedRows.length === 0) {
    return next(new AppError('No valid subscriber rows were found in this import.', 400));
  }

  const existingSubscribers = await Subscriber.find({
    orgId: req.org._id,
    phoneNumber: { $in: normalizedRows.map((row) => row.phoneNumber) },
  }).select('phoneNumber');

  const existingPhoneNumbers = new Set(existingSubscribers.map((subscriber) => subscriber.phoneNumber));
  const newRows = normalizedRows.filter((row) => !existingPhoneNumbers.has(row.phoneNumber));
  const currentSubscriberCount = await Subscriber.countDocuments({ orgId: req.org._id });
  const subscriberLimit = plan.getLimit('subscribers');

  if (currentSubscriberCount + newRows.length > subscriberLimit) {
    return next(
      new AppError(
        `This import would exceed your current plan's subscriber limit of ${subscriberLimit}.`,
        403
      )
    );
  }

  const summary = {
    totalRows: payloadRows.length,
    validRows: normalizedRows.length,
    newSubscribers: newRows.length,
    updatedSubscribers: normalizedRows.length - newRows.length,
    skippedRows,
    dryRun,
  };

  if (dryRun) {
    return res.status(200).json({
      status: 'success',
      data: { summary },
    });
  }

  // 👉 NEW: Extract all unique tags from the CSV and auto-merge them into the Master List
  const allImportedTags = new Set<string>();
  normalizedRows.forEach(row => {
    if (Array.isArray(row.tags)) {
      row.tags.forEach(tag => allImportedTags.add(tag));
    }
  });

  if (allImportedTags.size > 0) {
    // $addToSet with $each safely merges only the new tags into the org's existing array
    await Organization.findByIdAndUpdate(req.org._id, {
      $addToSet: { tags: { $each: Array.from(allImportedTags) } }
    });
  }

  const now = new Date();
  const orgObjectId = new mongoose.Types.ObjectId(String(req.org._id));
  const existingOperations = normalizedRows
    .filter((row) => existingPhoneNumbers.has(row.phoneNumber))
    .map((row) => ({
      updateOne: {
        filter: {
          orgId: orgObjectId,
          phoneNumber: row.phoneNumber,
        },
        update: {
          $set: {
            ...(row.firstName ? { firstName: row.firstName } : {}),
            ...(row.lastName ? { lastName: row.lastName } : {}),
            ...(row.tags ? { tags: row.tags } : {}),
            ...(row.metadata ? { metadata: row.metadata } : {}),
            ...(typeof row.isOptedIn === 'boolean' ? { isOptedIn: row.isOptedIn } : {}),
            ...(row.optInSource ? { optInSource: row.optInSource } : {}),
            lastInteraction: now,
          },
        },
      },
    }));

  const newOperations = normalizedRows
    .filter((row) => !existingPhoneNumbers.has(row.phoneNumber))
    .map((row) => ({
      updateOne: {
        filter: {
          orgId: orgObjectId,
          phoneNumber: row.phoneNumber,
        },
        update: {
          $set: {
            ...(row.firstName ? { firstName: row.firstName } : {}),
            ...(row.lastName ? { lastName: row.lastName } : {}),
            tags: row.tags && row.tags.length > 0 ? row.tags : ['General'],
            metadata: row.metadata || {},
            isOptedIn: typeof row.isOptedIn === 'boolean' ? row.isOptedIn : true,
            optInSource: row.optInSource || 'bulk_import',
            lastInteraction: now,
          },
          $setOnInsert: {
            orgId: req.org._id,
            phoneNumber: row.phoneNumber,
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));

  for (const operationsChunk of chunkArray([...existingOperations, ...newOperations], 1000)) {
    await Subscriber.bulkWrite(operationsChunk, { ordered: false });
  }

  const latestSubscriberCount = await Subscriber.countDocuments({ orgId: req.org._id });
  await Organization.findByIdAndUpdate(req.org._id, {
    $set: {
      'usage.subscribersCount': latestSubscriberCount,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Subscribers imported successfully.',
    data: {
      summary: {
        ...summary,
        currentSubscriberCount: latestSubscriberCount,
      },
    },
  });
});


export const bulkDeleteSubscribers = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { subscriberIds } = req.body;
  const orgId = req.org._id;

  // 1. Verify ownership (only isolate IDs that actually belong to this org)
  const validSubscribers = await Subscriber.find({
    _id: { $in: subscriberIds },
    orgId: orgId
  }).select('_id');

  const validIds = validSubscribers.map(sub => sub._id);

  if (validIds.length === 0) {
    return next(new AppError('No valid subscribers found to delete.', 404));
  }

  // 2. Cascade wipe all data using the bulk array
  await Promise.all([
    Subscriber.deleteMany({ _id: { $in: validIds } }),
    Conversation.deleteMany({ orgId, subscriberId: { $in: validIds } }),
    Message.deleteMany({ orgId, subscriberId: { $in: validIds } })
  ]);

  // 3. Decrement the organization's billing tracker accurately
  await Organization.findByIdAndUpdate(orgId, {
    $inc: { 'usage.subscribersCount': -validIds.length },
  });

  res.status(200).json({
    status: 'success',
    message: `Successfully deleted ${validIds.length} subscribers.`,
    data: { deletedCount: validIds.length }
  });
});

export const attachTagsToSubscriber = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  // Accept either a single string or an array of tags
  const requestedTags = Array.isArray(req.body.tags) ? req.body.tags : [req.body.tags];

  // 1. Validate against the Organization Master List
  const org = await Organization.findById(req.org._id).select('tags');
  const validTags = new Set(org?.tags || []);
  const invalidTags = requestedTags.filter((tag: string) => !validTags.has(tag));

  if (invalidTags.length > 0) {
    return next(new AppError(`The following tags are unauthorized: ${invalidTags.join(', ')}. Please add them in Organization Settings first.`, 400));
  }

  // 2. Safely Append using $addToSet and $each (Prevents duplicates and wipes)
  const subscriber = await Subscriber.findOneAndUpdate(
    { _id: req.params.subscriberId, orgId: req.org._id },
    { $addToSet: { tags: { $each: requestedTags } } },
    { new: true, runValidators: true }
  );

  if (!subscriber) return next(new AppError('Subscriber not found.', 404));

  res.status(200).json({ status: 'success', data: { subscriber } });
});

export const detachTagFromSubscriber = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { tag } = req.params;
  const decodedTag = decodeURIComponent(tag).trim();

  // 1. Safely Remove the tag using $pull
  const subscriber = await Subscriber.findOneAndUpdate(
    { _id: req.params.subscriberId, orgId: req.org._id },
    { $pull: { tags: decodedTag } },
    { new: true, runValidators: true }
  );

  if (!subscriber) return next(new AppError('Subscriber not found.', 404));

  // 2. The "General" Fallback Check
  if (subscriber.tags.length === 0) {
    subscriber.tags.push('General');
    await subscriber.save();
  }

  res.status(200).json({ status: 'success', data: { subscriber } });
});