import type { Socket } from 'socket.io';
import type { Server as SocketServer } from 'socket.io';

import { verifyAccessToken } from '../../config/jwt.js';
import { setSocketServer } from '../../lib/socket-instance.js';
import { logger } from '../../config/logger.js';
import { getPool } from '../../db/pool.js';

type SocketAuthUser = {
  id: string;
};

const emitSocketError = (socket: Socket, code: string, message: string): void => {
  socket.emit('socket_error', { code, message });
};

const extractAccessToken = (socket: Socket): string | null => {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim();
  }

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    return token.length > 0 ? token : null;
  }

  return null;
};

const canJoinApplicationRoom = async (applicationId: string, userId: string): Promise<boolean> => {
  const { rows } = await getPool().query<{ expert_id: string; business_id: string }>(
    `SELECT a.expert_id, j.business_id
     FROM job_applications a
     JOIN jobs j ON j.id = a.job_id
     WHERE a.id = $1
     LIMIT 1`,
    [applicationId],
  );
  const participants = rows[0];
  if (!participants) return false;
  return participants.expert_id === userId || participants.business_id === userId;
};

export const registerChatSocket = (io: SocketServer): void => {
  setSocketServer(io);
  io.use((socket, next) => {
    const token = extractAccessToken(socket);
    if (!token) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    try {
      const payload = verifyAccessToken(token);
      socket.data.authUser = { id: payload.sub } as SocketAuthUser;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const authUser = socket.data.authUser as SocketAuthUser | undefined;
    if (!authUser) {
      socket.disconnect(true);
      return;
    }

    logger.info('Socket connected', { socketId: socket.id });

    socket.emit('chat:welcome', {
      message: 'Welcome to MohandisHub realtime channel.',
      socketId: socket.id,
    });

    socket.on('join_user', (payload: { userId?: string }) => {
      const uid = payload?.userId;
      if (!uid || typeof uid !== 'string') {
        emitSocketError(socket, 'INVALID_INPUT', 'userId is required.');
        return;
      }
      if (uid !== authUser.id) {
        emitSocketError(socket, 'FORBIDDEN_ROOM_JOIN', 'Cannot join another user room.');
        return;
      }
      socket.join(`user:${uid}`);
    });

    socket.on('join_application', async (payload: { applicationId?: string }) => {
      const appId = payload?.applicationId;
      if (!appId || typeof appId !== 'string') {
        emitSocketError(socket, 'INVALID_INPUT', 'applicationId is required.');
        return;
      }
      try {
        const allowed = await canJoinApplicationRoom(appId, authUser.id);
        if (!allowed) {
          emitSocketError(socket, 'FORBIDDEN_ROOM_JOIN', 'Not authorized for this application room.');
          return;
        }
        socket.join(`application:${appId}`);
      } catch {
        emitSocketError(socket, 'ROOM_JOIN_FAILED', 'Could not join application room.');
      }
    });

    socket.on('leave_application', (payload: { applicationId?: string }) => {
      const appId = payload?.applicationId;
      if (appId && typeof appId === 'string') {
        socket.leave(`application:${appId}`);
      }
    });
    socket.on('join_conversation', (payload: { conversationId?: string }) => {
      const convId = payload?.conversationId;
      if (convId && typeof convId === 'string') {
        socket.join(`conversation:${convId}`);
      }
    });

    socket.on('leave_conversation', (payload: { conversationId?: string }) => {
      const convId = payload?.conversationId;
      if (convId && typeof convId === 'string') {
        socket.leave(`conversation:${convId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('Socket disconnected', {
        socketId: socket.id,
        reason,
      });
    });
  });
};
