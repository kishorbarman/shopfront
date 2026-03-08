import formbody from '@fastify/formbody';
import dotenv from 'dotenv';
import Fastify from 'fastify';

import healthRoutes from './routes/health';
import webhookRoutes from './routes/webhook';

dotenv.config();

const app = Fastify({
  logger: true,
});

async function buildServer() {
  await app.register(formbody);
  await app.register(healthRoutes);
  await app.register(webhookRoutes);

  return app;
}

async function start() {
  const port = Number(process.env.PORT ?? 3000);

  try {
    const server = await buildServer();
    await server.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
