import mongoose from 'mongoose';
import Organization from '../models/Organization';
import { createRedisPubSubConnection } from '../queues/redis';

const aiUsageRedis = createRedisPubSubConnection('whatching-ai-usage');

const buildAiUsageKey = (orgId: mongoose.Types.ObjectId | string) =>
  `org:${String(orgId)}:ai-usage`;

const addDays = (input: Date, days: number) => {
  const value = new Date(input);
  value.setDate(value.getDate() + days);
  return value;
};

export const trackMessagingUsage = async (
  orgId: mongoose.Types.ObjectId | string,
  counter: 'templateMessagesSent' | 'sessionMessagesSent'
) => {
  try {
    await Organization.findByIdAndUpdate(orgId, {
      $inc: { [`usage.${counter}`]: 1 },
      $set: { 'usage.lastMessageAt': new Date() },
    });
  } catch (error) {
    console.error(`Usage tracking failed for org ${String(orgId)}:`, error);
  }
};

export const ensureAiTokenCycle = async (orgId: mongoose.Types.ObjectId | string) => {
  const organization = await Organization.findById(orgId).select('usage subscriptionStatus planTier');
  if (!organization) {
    return null;
  }

  const now = new Date();
  const currentReset = organization.usage.aiTokensCycleResetsAt;

  if (!currentReset || currentReset.getTime() <= now.getTime()) {
    const nextReset = addDays(now, 30);
    organization.usage.aiTokensUsed = 0;
    organization.usage.aiTokensCycleStartedAt = now;
    organization.usage.aiTokensCycleResetsAt = nextReset;
    await organization.save({ validateBeforeSave: false });

    await aiUsageRedis.hset(buildAiUsageKey(orgId), {
      used: '0',
      cycleStartedAt: now.toISOString(),
      cycleResetsAt: nextReset.toISOString(),
    });
  } else {
    await aiUsageRedis.hset(buildAiUsageKey(orgId), {
      used: String(organization.usage.aiTokensUsed || 0),
      cycleStartedAt: organization.usage.aiTokensCycleStartedAt
        ? organization.usage.aiTokensCycleStartedAt.toISOString()
        : now.toISOString(),
      cycleResetsAt: currentReset.toISOString(),
    });
  }

  return organization;
};

export const getAiTokenUsageState = async (orgId: mongoose.Types.ObjectId | string) => {
  const organization = await ensureAiTokenCycle(orgId);
  if (!organization) {
    return null;
  }

  const redisState = await aiUsageRedis.hgetall(buildAiUsageKey(orgId));
  const used = Number.parseInt(redisState.used || '', 10);
  const totalUsed = Number.isFinite(used) ? used : organization.usage.aiTokensUsed || 0;

  return {
    used: totalUsed,
    cycleStartedAt:
      redisState.cycleStartedAt || organization.usage.aiTokensCycleStartedAt?.toISOString() || null,
    cycleResetsAt:
      redisState.cycleResetsAt || organization.usage.aiTokensCycleResetsAt?.toISOString() || null,
  };
};

export const trackAiTokenUsage = async (
  orgId: mongoose.Types.ObjectId | string,
  tokensUsed: number
) => {
  if (!Number.isFinite(tokensUsed) || tokensUsed <= 0) {
    return;
  }

  await ensureAiTokenCycle(orgId);

  await Promise.all([
    aiUsageRedis.hincrby(buildAiUsageKey(orgId), 'used', Math.round(tokensUsed)),
    Organization.findByIdAndUpdate(orgId, {
      $inc: { 'usage.aiTokensUsed': Math.round(tokensUsed) },
    }),
  ]);
};

export const synchronizeAiTokenCycleWindow = async ({
  orgId,
  cycleStartedAt,
  cycleResetsAt,
  resetUsage = false,
}: {
  orgId: mongoose.Types.ObjectId | string;
  cycleStartedAt?: Date | null;
  cycleResetsAt?: Date | null;
  resetUsage?: boolean;
}) => {
  const nextStart = cycleStartedAt || new Date();
  const nextReset = cycleResetsAt || addDays(nextStart, 30);
  const currentUsage = resetUsage ? 0 : (await getAiTokenUsageState(orgId))?.used || 0;

  await Promise.all([
    Organization.findByIdAndUpdate(orgId, {
      $set: {
        'usage.aiTokensCycleStartedAt': nextStart,
        'usage.aiTokensCycleResetsAt': nextReset,
        ...(resetUsage ? { 'usage.aiTokensUsed': 0 } : {}),
      },
    }),
    aiUsageRedis.hset(buildAiUsageKey(orgId), {
      used: String(currentUsage),
      cycleStartedAt: nextStart.toISOString(),
      cycleResetsAt: nextReset.toISOString(),
    }),
  ]);
};
