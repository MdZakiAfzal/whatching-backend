import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import Subscriber from '../models/Subscriber';
import Membership from '../models/Membership';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import {
  buildMessageCursor,
  serializeConversation,
  serializeMessage,
} from '../services/chatSerializationService';
import {
  publishConversationRead,
  publishConversationUpdated,
} from '../services/realtimeService';

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || '20'), 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const parseCursorPagination = (query: Record<string, unknown>) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || '30'), 10) || 30));
  const before = typeof query.before === 'string' && mongoose.Types.ObjectId.isValid(query.before)
    ? new mongoose.Types.ObjectId(query.before)
    : null;

  return { limit, before };
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

  if (typeof req.query.priority === 'string' && ['low', 'normal', 'high'].includes(req.query.priority)) {
    filter.priority = req.query.priority;
  }

  if (typeof req.query.mode === 'string' && ['interactive', 'ai_fallback', 'agent_manual'].includes(req.query.mode)) {
    filter.mode = req.query.mode;
  }

  if (req.query.unreadOnly === 'true') {
    filter.unreadCount = { $gt: 0 };
  }

  if (req.query.pendingEscalation === 'true') {
    filter.status = 'pending';
    filter.handoffRequestedAt = { $exists: true };
  }

  const searchTerm =
    typeof req.query.search === 'string' && req.query.search.trim().length > 0
      ? req.query.search.trim()
      : typeof req.query.q === 'string' && req.query.q.trim().length > 0
        ? req.query.q.trim()
        : '';

  if (searchTerm) {
    const searchRegex = new RegExp(searchTerm, 'i');
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

  const [conversations, total, summaryAgg] = await Promise.all([
    Conversation.find(filter)
      .populate('subscriberId', 'phoneNumber waId firstName lastName tags isOptedIn lastInteraction')
      .populate('assignedTo', 'name email phoneNumber')
      .populate('manualTakeoverBy', 'name email phoneNumber')
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Conversation.countDocuments(filter),
    Conversation.aggregate([
      {
        $match: { orgId: req.org._id },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          open: {
            $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] },
          },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
          },
          resolved: {
            $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] },
          },
          unread: {
            $sum: {
              $cond: [{ $gt: ['$unreadCount', 0] }, 1, 0],
            },
          },
          agentManual: {
            $sum: { $cond: [{ $eq: ['$mode', 'agent_manual'] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const summary = summaryAgg[0] || {
    total: 0,
    open: 0,
    pending: 0,
    resolved: 0,
    unread: 0,
    agentManual: 0,
  };

  res.status(200).json({
    status: 'success',
    results: conversations.length,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    data: {
      summary,
      conversations: conversations.map(serializeConversation),
    },
  });
});

export const getConversation = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    orgId: req.org._id,
  })
    .populate('subscriberId', 'phoneNumber waId firstName lastName tags metadata isOptedIn optInSource lastInteraction lastInboundAt lastOutboundAt')
    .populate('assignedTo', 'name email phoneNumber')
    .populate('manualTakeoverBy', 'name email phoneNumber');

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      conversation: serializeConversation(conversation),
    },
  });
});

export const getConversationContext = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    orgId: req.org._id,
  })
    .populate('subscriberId', 'phoneNumber waId firstName lastName tags metadata isOptedIn optInSource lastInteraction lastInboundAt lastOutboundAt')
    .populate('assignedTo', 'name email phoneNumber')
    .populate('manualTakeoverBy', 'name email phoneNumber');

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  const mediaSummary = await Message.aggregate([
    {
      $match: {
        orgId: req.org._id,
        conversationId: conversation._id,
      },
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      conversation: serializeConversation(conversation),
      subscriber:
        typeof (conversation.subscriberId as any)?.toObject === 'function'
          ? (conversation.subscriberId as any).toObject()
          : conversation.subscriberId,
      mediaSummary,
    },
  });
});

export const getConversationMessages = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { limit, before } = parseCursorPagination(req.query);

  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    orgId: req.org._id,
  });

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  const cursorFilter: Record<string, unknown> = {
    orgId: req.org._id,
    conversationId: conversation._id,
  };

  if (before) {
    cursorFilter._id = { $lt: before };
  }

  const messages = await Message.find(cursorFilter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('senderUserId', 'name email phoneNumber');

  const hasMore = messages.length > limit;
  const sliced = hasMore ? messages.slice(0, limit) : messages;
  const ordered = sliced.reverse();

  res.status(200).json({
    status: 'success',
    results: ordered.length,
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore ? buildMessageCursor(sliced[sliced.length - 1]) : null,
    },
    data: {
      conversation: {
        id: String(conversation._id),
        unreadCount: conversation.unreadCount,
      },
      messages: ordered.map(serializeMessage),
    },
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
  await conversation.populate('manualTakeoverBy', 'name email phoneNumber');

  await publishConversationUpdated(String(req.org._id), String(conversation._id));

  res.status(200).json({
    status: 'success',
    data: { conversation: serializeConversation(conversation) },
  });
});

export const markConversationRead = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const conversation = await Conversation.findOneAndUpdate(
    {
      _id: req.params.conversationId,
      orgId: req.org._id,
    },
    {
      $set: {
        unreadCount: 0,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    }
  )
    .populate('assignedTo', 'name email phoneNumber')
    .populate('subscriberId', 'phoneNumber waId firstName lastName')
    .populate('manualTakeoverBy', 'name email phoneNumber');

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  await publishConversationRead(String(req.org._id), String(conversation._id));

  res.status(200).json({
    status: 'success',
    data: {
      conversation: serializeConversation(conversation),
    },
  });
});

export const updateConversationStatus = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    orgId: req.org._id,
  })
    .populate('assignedTo', 'name email phoneNumber')
    .populate('subscriberId', 'phoneNumber waId firstName lastName')
    .populate('manualTakeoverBy', 'name email phoneNumber');

  if (!conversation) {
    return next(new AppError('Conversation not found for this organization.', 404));
  }

  conversation.status = req.body.status;
  if (req.body.status === 'resolved') {
    conversation.unreadCount = 0;
    conversation.mode = 'interactive';
    conversation.automationPausedUntil = undefined;
    conversation.handoffReason = undefined;
    conversation.handoffRequestedAt = undefined;
    conversation.manualTakeoverAt = undefined;
    conversation.manualTakeoverBy = undefined;
    conversation.lastAgentReplyAt = undefined;
  }
  await conversation.save();

  await publishConversationUpdated(String(req.org._id), String(conversation._id));

  res.status(200).json({
    status: 'success',
    data: { conversation: serializeConversation(conversation) },
  });
});
