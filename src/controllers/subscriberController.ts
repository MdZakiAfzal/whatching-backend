import { Response, NextFunction } from 'express';
import Subscriber from '../models/Subscriber';
import Conversation from '../models/Conversation';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || '20'), 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
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

  const [subscribers, total] = await Promise.all([
    Subscriber.find(filter)
      .sort({ lastInteraction: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Subscriber.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    results: subscribers.length,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    data: { subscribers },
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
  }).select('_id status assignedTo lastMessage lastMessageAt unreadCount');

  res.status(200).json({
    status: 'success',
    data: {
      subscriber,
      conversation,
    },
  });
});

export const updateSubscriber = catchAsync(async (req: any, res: Response, next: NextFunction) => {
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
  const subscriber = await Subscriber.findOneAndUpdate(
    {
      _id: req.params.subscriberId,
      orgId: req.org._id,
    },
    {
      $set: { tags: req.body.tags },
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
