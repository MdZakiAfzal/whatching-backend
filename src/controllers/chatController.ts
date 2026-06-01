import { Response } from 'express';
import Conversation from '../models/Conversation';
import BotSettings from '../models/BotSettings';
import BotFlow from '../models/BotFlow';
import catchAsync from '../utils/catchAsync';
import { getAiTokenUsageState } from '../services/usageService';

export const getChatBootstrap = catchAsync(async (req: any, res: Response) => {
  const [conversationSummary, botSettings, defaultFlow, aiUsage] = await Promise.all([
    Conversation.aggregate([
      { $match: { orgId: req.org._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
          unread: { $sum: { $cond: [{ $gt: ['$unreadCount', 0] }, 1, 0] } },
        },
      },
    ]),
    BotSettings.findOne({ orgId: req.org._id }),
    BotFlow.findOne({
      orgId: req.org._id,
      triggerKey: 'DEFAULT',
      status: 'published',
    }).select('_id triggerKey'),
    getAiTokenUsageState(req.org._id),
  ]);

  const summary = conversationSummary[0] || {
    total: 0,
    open: 0,
    pending: 0,
    resolved: 0,
    unread: 0,
  };

  res.status(200).json({
    status: 'success',
    data: {
      sidebar: summary,
      currentUser: {
        id: String(req.user._id),
        name: req.user.name,
        email: req.user.email,
        phoneNumber: req.user.phoneNumber,
      },
      messaging: {
        metaStatus: req.org.metaConfig?.status || 'pending',
        phoneNumberId: req.org.metaConfig?.phoneNumberId || null,
        displayPhoneNumber: req.org.metaConfig?.displayPhoneNumber || null,
      },
      bot: {
        settings: botSettings || null,
        defaultFlowReady: Boolean(defaultFlow),
        aiUsage,
      },
    },
  });
});
