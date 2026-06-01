import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import User from '../models/User';
import Membership from '../models/Membership';
import { config } from '../config';
import { createRedisPubSubConnection } from '../queues/redis';
import { loadSerializedConversation, loadSerializedMessage } from './chatSerializationService';

type RealtimeEnvelope = {
  room: string;
  event: string;
  data: unknown;
};

const REALTIME_CHANNEL = 'whatching:realtime';
let redisPublisher = createRedisPubSubConnection('whatching-realtime-publisher');

const orgRoom = (orgId: string) => `org:${orgId}`;
const conversationRoom = (orgId: string, conversationId: string) =>
  `org:${orgId}:conversation:${conversationId}`;

export const getOrgRoomName = orgRoom;
export const getConversationRoomName = conversationRoom;

export const publishRealtimeEvent = async (payload: RealtimeEnvelope) => {
  await redisPublisher.publish(REALTIME_CHANNEL, JSON.stringify(payload));
};

export const publishConversationUpdated = async (orgId: string, conversationId: string) => {
  const conversation = await loadSerializedConversation(orgId, conversationId);
  if (!conversation) return;

  await Promise.all([
    publishRealtimeEvent({
      room: orgRoom(orgId),
      event: 'conversation.updated',
      data: { conversation },
    }),
    publishRealtimeEvent({
      room: conversationRoom(orgId, conversationId),
      event: 'conversation.updated',
      data: { conversation },
    }),
  ]);
};

export const publishConversationRead = async (orgId: string, conversationId: string) => {
  const conversation = await loadSerializedConversation(orgId, conversationId);
  if (!conversation) return;

  await Promise.all([
    publishRealtimeEvent({
      room: orgRoom(orgId),
      event: 'conversation.read',
      data: { conversationId, conversation },
    }),
    publishRealtimeEvent({
      room: conversationRoom(orgId, conversationId),
      event: 'conversation.read',
      data: { conversationId, conversation },
    }),
  ]);
};

export const publishMessageCreated = async (
  orgId: string,
  conversationId: string,
  messageId: string
) => {
  const message = await loadSerializedMessage(orgId, messageId);
  if (!message) return;

  await Promise.all([
    publishRealtimeEvent({
      room: orgRoom(orgId),
      event: 'message.created',
      data: { conversationId, message },
    }),
    publishRealtimeEvent({
      room: conversationRoom(orgId, conversationId),
      event: 'message.created',
      data: { conversationId, message },
    }),
  ]);
};

export const publishMessageUpdated = async (
  orgId: string,
  conversationId: string,
  messageId: string
) => {
  const message = await loadSerializedMessage(orgId, messageId);
  if (!message) return;

  await Promise.all([
    publishRealtimeEvent({
      room: orgRoom(orgId),
      event: 'message.updated',
      data: { conversationId, message },
    }),
    publishRealtimeEvent({
      room: conversationRoom(orgId, conversationId),
      event: 'message.updated',
      data: { conversationId, message },
    }),
  ]);
};

export const publishEscalationEvent = async (
  orgId: string,
  conversationId: string,
  reason?: string
) => {
  const conversation = await loadSerializedConversation(orgId, conversationId);
  if (!conversation) return;

  await Promise.all([
    publishRealtimeEvent({
      room: orgRoom(orgId),
      event: 'conversation.escalated',
      data: { conversation, reason: reason || null },
    }),
    publishRealtimeEvent({
      room: conversationRoom(orgId, conversationId),
      event: 'conversation.escalated',
      data: { conversation, reason: reason || null },
    }),
  ]);
};

export const publishAgentTakeoverEvent = async (orgId: string, conversationId: string) => {
  const conversation = await loadSerializedConversation(orgId, conversationId);
  if (!conversation) return;

  await Promise.all([
    publishRealtimeEvent({
      room: orgRoom(orgId),
      event: 'conversation.agent_takeover',
      data: { conversation },
    }),
    publishRealtimeEvent({
      room: conversationRoom(orgId, conversationId),
      event: 'conversation.agent_takeover',
      data: { conversation },
    }),
  ]);
};

export const publishBotResumedEvent = async (orgId: string, conversationId: string) => {
  const conversation = await loadSerializedConversation(orgId, conversationId);
  if (!conversation) return;

  await Promise.all([
    publishRealtimeEvent({
      room: orgRoom(orgId),
      event: 'conversation.bot_resumed',
      data: { conversation },
    }),
    publishRealtimeEvent({
      room: conversationRoom(orgId, conversationId),
      event: 'conversation.bot_resumed',
      data: { conversation },
    }),
  ]);
};

const subscribeToRealtimeChannel = async (io: Server) => {
  const subscriber = createRedisPubSubConnection('whatching-realtime-subscriber');
  await subscriber.subscribe(REALTIME_CHANNEL);

  subscriber.on('message', (channel, message) => {
    if (channel !== REALTIME_CHANNEL) return;

    try {
      const payload = JSON.parse(message) as RealtimeEnvelope;
      io.to(payload.room).emit(payload.event, payload.data);
    } catch (error) {
      console.error('Failed to emit realtime event:', error);
    }
  });
};

export const initializeSocketServer = (io: Server) => {
  io.use(async (socket, next) => {
    try {
      const token =
        typeof socket.handshake.auth?.token === 'string'
          ? socket.handshake.auth.token
          : undefined;

      if (!token) {
        return next(new Error('Authentication required.'));
      }

      const decoded: any = await (promisify(jwt.verify) as any)(token, config.jwtSecret);
      const user = await User.findById(decoded.id).select('_id name email phoneNumber');

      if (!user) {
        return next(new Error('Authenticated user not found.'));
      }

      (socket.data as any).user = user;
      next();
    } catch (error) {
      next(new Error('Invalid authentication token.'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('org:join', async (payload: { orgId?: string }) => {
      if (!payload?.orgId) return;

      const membership = await Membership.findOne({
        userId: (socket.data as any).user._id,
        orgId: payload.orgId,
        status: 'active',
      }).select('_id');

      if (!membership) {
        socket.emit('socket.error', { message: 'Access denied for organization room.' });
        return;
      }

      socket.join(orgRoom(payload.orgId));
    });

    socket.on(
      'conversation:join',
      async (payload: { orgId?: string; conversationId?: string }) => {
        if (!payload?.orgId || !payload?.conversationId) return;

        const membership = await Membership.findOne({
          userId: (socket.data as any).user._id,
          orgId: payload.orgId,
          status: 'active',
        }).select('_id');

        if (!membership) {
          socket.emit('socket.error', { message: 'Access denied for conversation room.' });
          return;
        }

        socket.join(conversationRoom(payload.orgId, payload.conversationId));
      }
    );

    socket.on(
      'conversation:leave',
      (payload: { orgId?: string; conversationId?: string }) => {
        if (!payload?.orgId || !payload?.conversationId) return;
        socket.leave(conversationRoom(payload.orgId, payload.conversationId));
      }
    );
  });

  void subscribeToRealtimeChannel(io);
};
