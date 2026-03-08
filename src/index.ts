import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import path from 'node:path';

import config from './config';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import healthRoutes from './routes/health';
import metricsRoutes from './routes/metrics';
import pagesRoutes from './routes/pages';
import webhookRoutes from './routes/webhook';

export async function buildServer() {
  let requestCount = 0;
  const startedAt = Date.now();

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    trustProxy: true,
  });

  app.addHook('onRequest', async () => {
    requestCount += 1;
  });

  await app.register(cors, {
    origin: config.NODE_ENV === 'production' ? config.BASE_URL : true,
  });
  await app.register(helmet);
  await app.register(formbody);
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/public/',
  });
  await app.register(healthRoutes);
  await app.register(metricsRoutes, {
    getRequestCount: () => requestCount,
    startedAt,
  });
  await app.register(webhookRoutes);
  await app.register(pagesRoutes);

  return app;
}

export async function start() {
  const app = await buildServer();

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'Shutting down gracefully');

    try {
      await app.close();
      await redis.quit();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      app.log.error(error, 'Graceful shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info({ port: config.PORT }, 'Shopfront server started');
  } catch (error) {
    app.log.error(error);
    await redis.quit();
    await prisma.$disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
