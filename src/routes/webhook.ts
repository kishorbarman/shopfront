import type { FastifyPluginAsync } from 'fastify';

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/webhook/sms', async () => {
    return { status: 'received' };
  });

  fastify.post('/api/webhook/whatsapp', async () => {
    return { status: 'received' };
  });
};

export default webhookRoutes;
