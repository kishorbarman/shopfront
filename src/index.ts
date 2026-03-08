import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import path from 'node:path';

import healthRoutes from './routes/health';
import pagesRoutes from './routes/pages';
import webhookRoutes from './routes/webhook';

dotenv.config();

const app = Fastify({
  logger: true,
});

export async function buildServer() {
  await app.register(formbody);
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/public/',
  });
  await app.register(healthRoutes);
  await app.register(webhookRoutes);
  await app.register(pagesRoutes);

  return app;
}

export async function start() {
  const port = Number(process.env.PORT ?? 3000);

  try {
    const server = await buildServer();
    await server.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
