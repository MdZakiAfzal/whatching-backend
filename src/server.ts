import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { connectDB } from './loaders/database';
import AppError from './utils/AppError';
import globalErrorHandler from './middlewares/errorMiddleware';
import orgRoutes from './routes/organizationRoutes';
import userRoutes from './routes/userRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import templateRoutes from './routes/templateRoutes';
import messageRoutes from './routes/messageRoutes';
import conversationRoutes from './routes/conversationRoutes';
import subscriberRoutes from './routes/subscriberRoutes';
import broadcastRoutes from './routes/broadcastRoutes';
import mediaRoutes from './routes/mediaRoutes';
import chatRoutes from './routes/chatRoutes';
import botRoutes from './routes/botRoutes';
import { initializeSocketServer } from './services/realtimeService';

const bootstrap = async () => {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
    })
  );
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(cookieParser());

  if (config.env === 'development') {
    app.use(morgan('dev'));
  }

  await connectDB();

  app.get('/health', (_req, res) => {
    res.status(200).send('OK');
  });

  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/organizations', orgRoutes);
  app.use('/api/v1/whatsapp', whatsappRoutes);
  app.use('/api/v1/organizations/templates', templateRoutes);
  app.use('/api/v1/organizations/messages', messageRoutes);
  app.use('/api/v1/organizations/conversations', conversationRoutes);
  app.use('/api/v1/organizations/subscribers', subscriberRoutes);
  app.use('/api/v1/organizations/broadcasts', broadcastRoutes);
  app.use('/api/v1/organizations/media', mediaRoutes);
  app.use('/api/v1/organizations/chat', chatRoutes);
  app.use('/api/v1/organizations/bot', botRoutes);
  app.use('/api/v1/templates', templateRoutes);
  app.use('/api/v1/messages', messageRoutes);

  app.all('*path', (req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
  });

  app.use(globalErrorHandler);

  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: config.frontendUrl,
      credentials: true,
    },
  });
  initializeSocketServer(io);

  server.listen(config.port, () => {
    console.log(`🚀 Server started on port: ${config.port}`);
  });
};

void bootstrap();
