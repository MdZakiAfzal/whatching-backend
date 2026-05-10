import mongoose from 'mongoose';
import { config } from '../config';

const syncRegisteredIndexes = async () => {
  const models = Object.values(mongoose.models);
  if (models.length === 0) {
    return;
  }

  await Promise.all(models.map(async (model) => {
    await model.syncIndexes();
  }));
};

export const connectDB = async () => {
  try {
    mongoose.connection.on('connected', () => {
      console.log('📶 DB connected successfully...');
    });

    mongoose.connection.on('error', (err) => {
      console.error(`🛑 MongoDB Atlas Error: ${err}`);
    });

    await mongoose.connect(config.mongoUri);

    if (config.env !== 'production') {
      await syncRegisteredIndexes();
      console.log('🧭 Mongo indexes synced for local/test environment');
    }
  } catch (error) {
    console.error('🔥 Initial Atlas connection failed:', error);
    process.exit(1);
  }
};
