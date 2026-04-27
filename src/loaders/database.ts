import mongoose from 'mongoose';
import { config } from '../config';

export const connectDB = async () => {
  try {
    mongoose.connection.on('connected', () => {
      console.log('📶 DB connected successfully...');
    });

    mongoose.connection.on('error', (err) => {
      console.error(`🛑 MongoDB Atlas Error: ${err}`);
    });

    await mongoose.connect(config.mongoUri);
  } catch (error) {
    console.error('🔥 Initial Atlas connection failed:', error);
    process.exit(1);
  }
};