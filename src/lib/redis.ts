import Redis from 'ioredis';

import config from '../config';

const globalForRedis = globalThis as unknown as {
  redis?: Redis;
};

function createRedisClient(): Redis {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  client.on('error', (error) => {
    console.error('Redis connection error:', error);
  });

  client.on('connect', () => {
    console.log('Redis connected');
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (config.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
