import IORedis from 'ioredis';
import { config } from '../config';

const buildRedisConnection = (connectionName: string) =>
  new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectionName,
  });

export const queueConnection = buildRedisConnection('whatching-queue');

export const createWorkerConnection = (connectionName: string) =>
  buildRedisConnection(connectionName);
