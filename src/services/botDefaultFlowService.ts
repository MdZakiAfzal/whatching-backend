import mongoose from 'mongoose';
import BotFlow from '../models/BotFlow';
import BotSettings from '../models/BotSettings';

export const REQUIRED_BOT_TRIGGER_KEYS = {
  default: 'DEFAULT',
  optOut: 'OPT_OUT',
} as const;

export const DEFAULT_OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT', 'CANCEL'];

const buildRequiredFlows = ({
  orgId,
  userId,
}: {
  orgId: mongoose.Types.ObjectId | string;
  userId?: mongoose.Types.ObjectId | string;
}) => [
  {
    orgId,
    createdBy: userId,
    updatedBy: userId,
    status: 'published' as const,
    triggerKey: REQUIRED_BOT_TRIGGER_KEYS.default,
    name: 'Default Menu',
    blockType: 'text' as const,
    sortOrder: 0,
    content: {
      text: 'Hi, thanks for messaging us. How can we help you today?',
    },
    actions: [],
    publishedAt: new Date(),
  },
  {
    orgId,
    createdBy: userId,
    updatedBy: userId,
    status: 'published' as const,
    triggerKey: REQUIRED_BOT_TRIGGER_KEYS.optOut,
    name: 'Opt Out Confirmation',
    blockType: 'text' as const,
    sortOrder: 1,
    content: {
      text: 'You have been opted out and will no longer receive promotional messages from us.',
    },
    actions: [],
    publishedAt: new Date(),
  },
];

export const isRequiredBotTriggerKey = (triggerKey?: string | null) =>
  triggerKey === REQUIRED_BOT_TRIGGER_KEYS.default || triggerKey === REQUIRED_BOT_TRIGGER_KEYS.optOut;

export const ensureRequiredBotFlows = async ({
  orgId,
  userId,
}: {
  orgId: mongoose.Types.ObjectId | string;
  userId?: mongoose.Types.ObjectId | string;
}) => {
  const requiredFlows = buildRequiredFlows({ orgId, userId });

  for (const requiredFlow of requiredFlows) {
    const existingFlow = await BotFlow.findOne({
      orgId,
      triggerKey: requiredFlow.triggerKey,
      status: { $in: ['draft', 'published'] },
    }).select('_id');

    if (!existingFlow) {
      await BotFlow.create(requiredFlow);
    }
  }

  await BotSettings.findOneAndUpdate(
    { orgId },
    {
      $setOnInsert: {
        orgId,
        ...(userId ? { updatedBy: userId } : {}),
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );
};
