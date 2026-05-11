import { Response, NextFunction } from 'express';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import Subscriber from '../models/Subscriber';
import Membership from '../models/Membership';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || '20'), 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

export const listConversations = catchAsync(async (req: any, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter: Record<string, unknown> = { orgId: req.org._id };

  if (typeof req.query.status === 'string' && ['open', 'pending', 'resolved'].includes(req.query.status)) {
    filter.status = req.query.status;
  }

  if (typeof req.query.assignedTo === 'string' && req.query.assignedTo.length > 0) {
    filter.assignedTo = req.query.assignedTo;
  }

  if (typeof req.query.q === 'string' && req.query.q.trim().length > 0) {
    const searchRegex = new RegExp(req.query.q.trim(), 'i');
    const matchingSubscribers = await Subscriber.find({
      orgId: req.org._id,
      $or: [
        { phoneNumber: searchRegex },
        { firstName: searchRegex },
        { lastName: searchRegex },
      ],
    }).select('_id');

    filter.subscriberId = {
      $in: matchingSubscribers.map((subscriber) => subscriber._id),
    };
  }

  const [conversations, total] = await Promise.all([
    Conversation.find(filter)
      .populate('subscriberId', 'phoneNumber waId firstName lastName tags isOptedIn lastInteraction')
      .populate('assignedTo', 'name email phoneNumber')
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Conversation.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    results: conversations.length,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    data: { conversations },
  });
});

export const getConversationMessages = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { page, limit, skip } = parsePagination(req.query);

  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    orgId: req.org._id,
  });

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  const [messages, total] = await Promise.all([
    Message.find({
      orgId: req.org._id,
      conversationId: conversation._id,
    })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit),
    Message.countDocuments({
      orgId: req.org._id,
      conversationId: conversation._id,
    }),
  ]);

  await Conversation.findByIdAndUpdate(conversation._id, {
    $set: { unreadCount: 0 },
  });

  res.status(200).json({
    status: 'success',
    results: messages.length,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    data: { messages },
  });
});

export const assignConversation = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { assignedToUserId } = req.body;

  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    orgId: req.org._id,
  });

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  if (assignedToUserId) {
    const assigneeMembership = await Membership.findOne({
      orgId: req.org._id,
      userId: assignedToUserId,
      status: 'active',
    }).populate('userId', 'name email phoneNumber');

    if (!assigneeMembership) {
      return next(new AppError('The selected assignee is not an active member of this organization.', 400));
    }

    conversation.assignedTo = assigneeMembership.userId._id;
  } else {
    conversation.assignedTo = undefined;
  }

  await conversation.save();
  await conversation.populate('assignedTo', 'name email phoneNumber');
  await conversation.populate('subscriberId', 'phoneNumber waId firstName lastName');

  res.status(200).json({
    status: 'success',
    data: { conversation },
  });
});

export const updateConversationStatus = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    orgId: req.org._id,
  })
    .populate('assignedTo', 'name email phoneNumber')
    .populate('subscriberId', 'phoneNumber waId firstName lastName');

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  conversation.status = req.body.status;
  if (req.body.status === 'resolved') {
    conversation.unreadCount = 0;
  }
  await conversation.save();

  res.status(200).json({
    status: 'success',
    data: { conversation },
  });
});
