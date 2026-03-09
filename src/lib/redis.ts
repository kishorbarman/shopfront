import Redis from 'ioredis';

import config from '../config';
import logger from './logger';

const globalForRedis = globalThis as unknown as {
  redis?: Redis;
};

function createRedisClient(): Redis {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  client.on('error', (error) => {
    logger.error(
      {
        event: 'error',
        type: 'RedisConnectionError',
        message: error.message,
        stack: error.stack,
      },
      'Redis connection error',
    );
  });

  client.on('connect', () => {
    logger.info({ event: 'redis_connected' }, 'Redis connected');
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (config.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
