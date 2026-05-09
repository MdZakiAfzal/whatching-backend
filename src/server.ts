import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { config } from './config';
import { connectDB } from './loaders/database';
import AppError from './utils/AppError';
import globalErrorHandler from './middlewares/errorMiddleware';
import orgRoutes from './routes/organizationRoutes';
import userRoutes from './routes/userRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import templateRoutes from './routes/templateRoutes';

const bootstrap = async () => {
  const app = express();

  // 1. Security Middlewares
  app.use(helmet());
  app.use(cors({
    origin: config.frontendUrl,
    credentials: true, 
  }));
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  }));
  app.use(cookieParser());

  // 2. Logger (Morgan)
  if (config.env === 'development') {
    app.use(morgan('dev'));
  }

  // 3. Connect to MongoDB Atlas
  await connectDB();

  // 3. Health Check
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/organizations', orgRoutes);
  app.use('/api/v1/whatsapp', whatsappRoutes);
  app.use('/api/v1/templates', templateRoutes);

  // Using the named wildcard syntax '*path'
  app.all('*path', (req: Request, res: Response, next: NextFunction) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
  });

  // 3. Global Error Handling Middleware
  // This must be the LAST middleware in the stack
  app.use(globalErrorHandler);

  // 4. Start Listening
  app.listen(config.port, () => {
    console.log(`🚀 Server started on port: ${config.port}`);
  });
};

bootstrap();
