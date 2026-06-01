import BotSettings from '../models/BotSettings';
import BotFlow from '../models/BotFlow';
import Conversation from '../models/Conversation';
import Subscriber from '../models/Subscriber';
import { PlanManager } from '../utils/planManager';
import {
  buildMetaPayloadFromFlow,
  getBotDefaultFlow,
  getPublishedFlowByTriggerKey,
  normalizeTriggerKey,
  resolveInteractiveAction,
} from './botFlowService';
import {
  createSystemConversationMessage,
  sendBotMetaMessage,
} from './botMessagingService';
import { generateBotAiResponse } from './geminiService';
import { retrieveKnowledgeChunks } from './knowledgeService';
import { getAiTokenUsageState, trackAiTokenUsage } from './usageService';
import {
  publishConversationUpdated,
  publishEscalationEvent,
} from './realtimeService';
import { logIntegrationAction } from './integrationLogService';
import {
  DEFAULT_OPT_OUT_KEYWORDS,
  ensureRequiredBotFlows,
  REQUIRED_BOT_TRIGGER_KEYS,
} from './botDefaultFlowService';

const normalizeKeyword = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

const isConversationPaused = (conversation: any) =>
  conversation.mode === 'agent_manual' &&
  conversation.automationPausedUntil &&
  new Date(conversation.automationPausedUntil).getTime() > Date.now();

const setConversationPending = async ({
  conversation,
  reason,
}: {
  conversation: any;
  reason: string;
}) => {
  conversation.status = 'pending';
  conversation.handoffRequestedAt = new Date();
  conversation.handoffReason = reason;
  await conversation.save();
};

const buildFlowPreviewText = (flow: any) => {
  if (flow.blockType === 'text') {
    return String(flow.content?.text || '').trim();
  }

  if (flow.blockType === 'buttons' || flow.blockType === 'list' || flow.blockType === 'product_carousel') {
    return String(flow.content?.bodyText || flow.name || '[Interactive message]').trim();
  }

  if (flow.blockType === 'generic_carousel') {
    const firstCard = Array.isArray(flow.content?.cards) ? flow.content.cards[0] : null;
    return String(firstCard?.bodyText || flow.name || '[Carousel message]').trim();
  }

  if (flow.blockType === 'location') {
    return `[Location: ${String(flow.content?.name || 'Map pin')}]`;
  }

  if (flow.blockType === 'document') {
    return String(flow.content?.caption || `[Document: ${String(flow.content?.filename || flow.name)}]`);
  }

  if (flow.blockType === 'image') {
    return String(flow.content?.caption || `[Image: ${flow.name}]`);
  }

  return `[Bot Block: ${flow.name}]`;
};

const sendFlow = async ({
  organization,
  conversation,
  subscriber,
  flow,
}: {
  organization: any;
  conversation: any;
  subscriber: any;
  flow: any;
}) => {
  const payload = buildMetaPayloadFromFlow(flow, subscriber.phoneNumber) as Record<string, unknown>;
  const previewText = buildFlowPreviewText(flow);

  await sendBotMetaMessage({
    organization,
    conversation,
    subscriber,
    type:
      payload.type === 'text'
        ? 'text'
        : payload.type === 'location'
          ? 'location'
          : payload.type === 'image'
            ? 'image'
            : payload.type === 'document'
              ? 'document'
              : 'interactive',
    payload,
    previewText,
  });

  conversation.mode = 'interactive';
  conversation.activeFlowId = flow._id;
  conversation.activeTriggerKey = flow.triggerKey;
  await conversation.save();

  await createSystemConversationMessage({
    organization,
    conversation,
    subscriber,
    previewText: `Bot routed to flow: ${flow.name}`,
    systemEventType: 'bot_flow_routed',
    payload: {
      triggerKey: flow.triggerKey,
      blockType: flow.blockType,
    },
  });

  await publishConversationUpdated(String(organization._id), String(conversation._id));
};

const sendDefaultFlow = async ({
  organization,
  conversation,
  subscriber,
  settings,
}: {
  organization: any;
  conversation: any;
  subscriber: any;
  settings: any;
}) => {
  const flow = await getBotDefaultFlow(String(organization._id), settings.defaultTriggerKey || 'DEFAULT');
  if (!flow) {
    return false;
  }

  await sendFlow({
    organization,
    conversation,
    subscriber,
    flow,
  });
  return true;
};

const sendOptOutFlow = async ({
  organization,
  conversation,
  subscriber,
}: {
  organization: any;
  conversation: any;
  subscriber: any;
}) => {
  const flow = await getPublishedFlowByTriggerKey(
    String(organization._id),
    REQUIRED_BOT_TRIGGER_KEYS.optOut
  );
  if (!flow) {
    return false;
  }

  await sendFlow({
    organization,
    conversation,
    subscriber,
    flow,
  });
  return true;
};

const markSubscriberOptedOut = async ({
  organization,
  conversation,
  subscriber,
  reason,
}: {
  organization: any;
  conversation: any;
  subscriber: any;
  reason: string;
}) => {
  const now = new Date();
  await Subscriber.findOneAndUpdate(
    {
      _id: subscriber._id,
      orgId: organization._id,
    },
    {
      $set: {
        isOptedIn: false,
        optedOutAt: now,
        optOutSource: reason,
        lastInteraction: now,
      },
    }
  );

  subscriber.isOptedIn = false;
  subscriber.optedOutAt = now;
  subscriber.optOutSource = reason;

  await createSystemConversationMessage({
    organization,
    conversation,
    subscriber,
    previewText: 'Subscriber opted out of promotional messages.',
    systemEventType: 'subscriber_opted_out',
    payload: { reason },
  });
};

const maybeEscalateConversation = async ({
  organization,
  conversation,
  subscriber,
  reason,
}: {
  organization: any;
  conversation: any;
  subscriber: any;
  reason: string;
}) => {
  await setConversationPending({ conversation, reason });
  await createSystemConversationMessage({
    organization,
    conversation,
    subscriber,
    previewText: 'Conversation escalated to a human agent.',
    systemEventType: 'conversation_escalated',
    payload: { reason },
  });
  await publishEscalationEvent(String(organization._id), String(conversation._id), reason);
};

const handleInteractiveReply = async ({
  organization,
  conversation,
  subscriber,
  settings,
  replyId,
}: {
  organization: any;
  conversation: any;
  subscriber: any;
  settings: any;
  replyId: string;
}) => {
  const activeFlow = conversation.activeFlowId
    ? await BotFlow.findOne({
        _id: conversation.activeFlowId,
        orgId: organization._id,
        status: 'published',
      })
    : null;

  const matchedAction = resolveInteractiveAction(activeFlow as any, replyId);
  const isEscalation =
    matchedAction?.type === 'escalate_to_agent' ||
    settings.escalationTriggerIds?.includes(replyId);

  if (isEscalation) {
    await maybeEscalateConversation({
      organization,
      conversation,
      subscriber,
      reason: 'interactive_escalation',
    });
    return { action: 'escalated' as const };
  }

  if (matchedAction?.type === 'end_conversation') {
    conversation.status = 'resolved';
    conversation.mode = 'interactive';
    await conversation.save();
    await createSystemConversationMessage({
      organization,
      conversation,
      subscriber,
      previewText: 'Conversation ended by bot flow action.',
      systemEventType: 'conversation_resolved',
    });
    await publishConversationUpdated(String(organization._id), String(conversation._id));
    return { action: 'resolved' as const };
  }

  const nextTriggerKey = matchedAction?.nextTriggerKey;
  if (!nextTriggerKey) {
    return { action: 'no_match' as const };
  }

  if (normalizeTriggerKey(nextTriggerKey) === REQUIRED_BOT_TRIGGER_KEYS.optOut) {
    await markSubscriberOptedOut({
      organization,
      conversation,
      subscriber,
      reason: 'interactive_opt_out',
    });
  }

  const nextFlow = await getPublishedFlowByTriggerKey(String(organization._id), nextTriggerKey);
  if (!nextFlow) {
    return { action: 'missing_next_flow' as const };
  }

  await sendFlow({
    organization,
    conversation,
    subscriber,
    flow: nextFlow,
  });
  return { action: 'executed_flow' as const, triggerKey: nextFlow.triggerKey };
};

const handleAiFallback = async ({
  organization,
  conversation,
  subscriber,
  settings,
  text,
}: {
  organization: any;
  conversation: any;
  subscriber: any;
  settings: any;
  text: string;
}) => {
  const plan = new PlanManager(organization);
  const defaultFlow = await getBotDefaultFlow(
    String(organization._id),
    settings.defaultTriggerKey || 'DEFAULT'
  );

  if (!plan.canUse('aiAgent') || !settings.isAiEnabled) {
    if (defaultFlow) {
      await sendFlow({ organization, conversation, subscriber, flow: defaultFlow });
      return { action: 'default_flow' as const };
    }
    return { action: 'skipped' as const };
  }

  const usage = await getAiTokenUsageState(organization._id);
  const aiLimit = plan.getLimit('aiTokens');

  if (
    Number.isFinite(aiLimit) &&
    usage &&
    usage.used >= aiLimit
  ) {
    await sendBotMetaMessage({
      organization,
      conversation,
      subscriber,
      type: 'text',
      payload: {
        type: 'text',
        text: {
          preview_url: false,
          body: 'Custom AI queries are currently limited on your plan, so I am opening the main menu for you instead.',
        },
      },
      previewText:
        'Custom AI queries are currently limited on your plan, so I am opening the main menu for you instead.',
      markAsLastBotMessage: false,
    });
    if (defaultFlow) {
      await sendFlow({ organization, conversation, subscriber, flow: defaultFlow });
    }
    return { action: 'quota_fallback' as const };
  }

  const publishedFlows = await BotFlow.find({
    orgId: organization._id,
    status: 'published',
  }).select('triggerKey');

  const knowledgeChunks = await retrieveKnowledgeChunks({
    orgId: organization._id,
    query: text,
    limit: 5,
  });

  const aiResult = await generateBotAiResponse({
    systemPrompt: settings.systemPrompt,
    businessName: organization.name,
    subscriberName: subscriber.firstName,
    question: text,
    knowledgeChunks,
    allowedTriggerKeys: publishedFlows.map((flow) => flow.triggerKey),
    model: settings.geminiModel,
  });

  conversation.mode = 'ai_fallback';
  await conversation.save();

  await createSystemConversationMessage({
    organization,
    conversation,
    subscriber,
    previewText: 'AI fallback handled the latest customer message.',
    systemEventType: 'ai_fallback_used',
    payload: {
      routeTriggerKey: aiResult.routeTriggerKey,
      needsHuman: aiResult.needsHuman,
      reason: aiResult.reason,
    },
  });

  if (aiResult.totalTokens > 0) {
    await trackAiTokenUsage(organization._id, aiResult.totalTokens);
  }

  if (aiResult.needsHuman) {
    if (aiResult.replyText) {
      await sendBotMetaMessage({
        organization,
        conversation,
        subscriber,
        type: 'text',
        payload: {
          type: 'text',
          text: {
            preview_url: false,
            body: aiResult.replyText,
          },
        },
        previewText: aiResult.replyText,
      });
    }

    await maybeEscalateConversation({
      organization,
      conversation,
      subscriber,
      reason: aiResult.reason || 'ai_requested_human_help',
    });
    return { action: 'escalated' as const };
  }

  if (aiResult.replyText) {
    await sendBotMetaMessage({
      organization,
      conversation,
      subscriber,
      type: 'text',
      payload: {
        type: 'text',
        text: {
          preview_url: false,
          body: aiResult.replyText,
        },
      },
      previewText: aiResult.replyText,
    });
  }

  if (aiResult.routeTriggerKey) {
    const routedFlow = await getPublishedFlowByTriggerKey(
      String(organization._id),
      aiResult.routeTriggerKey
    );

    if (routedFlow) {
      await sendFlow({
        organization,
        conversation,
        subscriber,
        flow: routedFlow,
      });
      return { action: 'ai_and_flow' as const, routeTriggerKey: routedFlow.triggerKey };
    }
  }

  return { action: 'ai_only' as const };
};

export const getOrCreateBotSettings = async (orgId: string, updatedBy?: string) =>
  BotSettings.findOneAndUpdate(
    { orgId },
    {
      $setOnInsert: {
        orgId,
        ...(updatedBy ? { updatedBy } : {}),
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );

export const routeIncomingMessage = async ({
  organization,
  conversation,
  subscriber,
  message,
}: {
  organization: any;
  conversation: any;
  subscriber: any;
  message: any;
}) => {
  const settings = await getOrCreateBotSettings(String(organization._id));
  await ensureRequiredBotFlows({
    orgId: organization._id,
  });

  const normalizedText = normalizeKeyword(message?.text?.body || '');
  const optOutSet = new Set([
    ...DEFAULT_OPT_OUT_KEYWORDS.map(normalizeKeyword),
    ...((settings?.optOutKeywords || []) as string[]).map(normalizeKeyword),
  ]);

  if (normalizedText && optOutSet.has(normalizedText)) {
    await markSubscriberOptedOut({
      organization,
      conversation,
      subscriber,
      reason: 'keyword_opt_out',
    });

    const sent = await sendOptOutFlow({
      organization,
      conversation,
      subscriber,
    });

    await logIntegrationAction({
      orgId: organization._id,
      action: 'subscriber_opt_out',
      status: 'success',
      details: {
        inboundMetaMessageId: message.id,
        triggerKey: REQUIRED_BOT_TRIGGER_KEYS.optOut,
        confirmationSent: sent,
      },
      externalRef: message.id,
    });

    return { action: sent ? 'opted_out' as const : 'opted_out_without_flow' as const };
  }

  if (!settings?.isBotEnabled) {
    return { action: 'bot_disabled' as const };
  }

  if (isConversationPaused(conversation)) {
    return { action: 'manual_pause' as const };
  }

  if (conversation.status === 'pending') {
    return { action: 'pending_wait' as const };
  }

  const interactiveReply =
    message?.interactive?.button_reply || message?.interactive?.list_reply;

  if (interactiveReply?.id) {
    return handleInteractiveReply({
      organization,
      conversation,
      subscriber,
      settings,
      replyId: interactiveReply.id,
    });
  }

  const greetingSet = new Set((settings.greetingKeywords || []).map(normalizeKeyword));

  if (normalizedText && greetingSet.has(normalizedText)) {
    const executed = await sendDefaultFlow({
      organization,
      conversation,
      subscriber,
      settings,
    });

    return { action: executed ? 'default_flow' as const : 'default_missing' as const };
  }

  if (normalizedText) {
    const result = await handleAiFallback({
      organization,
      conversation,
      subscriber,
      settings,
      text: message.text.body,
    });

    await logIntegrationAction({
      orgId: organization._id,
      action: 'bot_ai_route',
      status: 'success',
      details: {
        result,
        inboundMetaMessageId: message.id,
      },
      externalRef: message.id,
    });

    return result;
  }

  return { action: 'unsupported_inbound' as const };
};

export const getBotReadiness = async (orgId: string) => {
  await ensureRequiredBotFlows({ orgId });

  const [settings, defaultFlow, optOutFlow, publishedFlows] = await Promise.all([
    getOrCreateBotSettings(orgId),
    BotFlow.findOne({ orgId, status: 'published', triggerKey: 'DEFAULT' }).select('_id'),
    BotFlow.findOne({ orgId, status: 'published', triggerKey: REQUIRED_BOT_TRIGGER_KEYS.optOut }).select('_id'),
    BotFlow.countDocuments({ orgId, status: 'published' }),
  ]);

  return {
    settings,
    defaultFlowReady: Boolean(defaultFlow),
    optOutFlowReady: Boolean(optOutFlow),
    publishedFlowCount: publishedFlows,
  };
};
