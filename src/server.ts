import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { connectDB } from './loaders/database';

const bootstrap = async () => {
  const app = express();

  // 1. Security Middlewares
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // 2. Connect to MongoDB Atlas
  await connectDB();

  // 3. Health Check
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  // 4. Start Listening
  app.listen(config.port, () => {
    console.log(`
      ✅ Server Started
      🚀 Port: ${config.port}
      🌍 Mode: ${config.env}
    `);
  });
};

bootstrap();