import Conversation from '../models/Conversation';
import Message from '../models/Message';

export const buildReplyWindow = (lastInboundAt?: Date | null) => {
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

const resolveDisplayType = (message: any) => {
  if (message.type === 'system') {
    return 'system_event';
  }

  if (message.type === 'interactive') {
    return message.payload?.interactiveType || 'interactive';
  }

  if (message.type === 'unknown') {
    return 'unknown';
  }

  return message.type;
};

const resolveSenderRole = (message: any) => {
  switch (message.source) {
    case 'customer':
      return 'customer';
    case 'bot':
      return 'bot';
    case 'system':
      return 'system';
    case 'broadcast':
      return 'broadcast';
    case 'agent':
    default:
      return 'agent';
  }
};

export const serializeMessage = (message: any) => {
  const plainMessage =
    typeof message.toObject === 'function' ? message.toObject() : message;

  return {
    ...plainMessage,
    displayType: resolveDisplayType(plainMessage),
    senderRole: resolveSenderRole(plainMessage),
    attachment:
      plainMessage.payload?.mediaUrl || plainMessage.payload?.filename
        ? {
            mediaUrl: plainMessage.payload?.mediaUrl || null,
            mimeType: plainMessage.payload?.mimeType || null,
            filename:
              plainMessage.payload?.filename ||
              plainMessage.payload?.originalFilename ||
              null,
            publicId: plainMessage.payload?.publicId || null,
            storageStatus: plainMessage.payload?.storageStatus || null,
          }
        : null,
    interactive:
      plainMessage.type === 'interactive'
        ? {
            interactiveType: plainMessage.payload?.interactiveType || null,
            replyId: plainMessage.payload?.interactiveReplyId || null,
            replyTitle: plainMessage.payload?.interactiveReplyTitle || null,
          }
        : null,
    systemEvent:
      plainMessage.type === 'system'
        ? {
            eventType: plainMessage.payload?.systemEventType || null,
            message: plainMessage.payload?.systemMessage || plainMessage.payload?.text || null,
          }
        : null,
  };
};

export const serializeConversation = (conversation: any) => {
  const plainConversation =
    typeof conversation.toObject === 'function' ? conversation.toObject() : conversation;

  return {
    ...plainConversation,
    replyWindow: buildReplyWindow(plainConversation.lastInboundAt),
    botState: {
      mode: plainConversation.mode,
      activeFlowId: plainConversation.activeFlowId || null,
      activeTriggerKey: plainConversation.activeTriggerKey || null,
      automationPausedUntil: plainConversation.automationPausedUntil || null,
      lastBotMessageId: plainConversation.lastBotMessageId || null,
    },
    takeoverState: {
      handoffRequestedAt: plainConversation.handoffRequestedAt || null,
      handoffReason: plainConversation.handoffReason || null,
      manualTakeoverAt: plainConversation.manualTakeoverAt || null,
      manualTakeoverBy: plainConversation.manualTakeoverBy || null,
      lastAgentReplyAt: plainConversation.lastAgentReplyAt || null,
    },
  };
};

export const buildMessageCursor = (message: any) => {
  if (!message?._id) {
    return null;
  }

  return String(message._id);
};

export const loadSerializedConversation = async (
  orgId: string,
  conversationId: string
) => {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    orgId,
  })
    .populate('subscriberId', 'phoneNumber waId firstName lastName tags metadata isOptedIn lastInteraction lastInboundAt lastOutboundAt')
    .populate('assignedTo', 'name email phoneNumber')
    .populate('manualTakeoverBy', 'name email phoneNumber');

  return conversation ? serializeConversation(conversation) : null;
};

export const loadSerializedMessage = async (orgId: string, messageId: string) => {
  const message = await Message.findOne({
    _id: messageId,
    orgId,
  }).populate('senderUserId', 'name email phoneNumber');

  return message ? serializeMessage(message) : null;
};
