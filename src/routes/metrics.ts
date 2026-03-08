import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../lib/prisma';

type MetricsOptions = {
  getRequestCount: () => number;
  startedAt: number;
};

const metricsRoutes: FastifyPluginAsync<MetricsOptions> = async (fastify, options) => {
  fastify.get('/metrics', async () => {
    const activeShops = await prisma.shop.count({
      where: { status: 'ACTIVE' },
    });

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - options.startedAt) / 1000),
      requestCount: options.getRequestCount(),
      activeShops,
    };
  });
};

export default metricsRoutes;
