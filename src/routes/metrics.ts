import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../lib/prisma';
import { getOpsMetrics } from '../lib/opsMetrics';

type MetricsOptions = {
  getRequestCount: () => number;
  startedAt: number;
};

const metricsRoutes: FastifyPluginAsync<MetricsOptions> = async (fastify, options) => {
  fastify.get('/metrics', async () => {
    const activeShops = await prisma.shop.count({
      where: { status: 'ACTIVE' },
    });

    const ops = getOpsMetrics();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - options.startedAt) / 1000),
      requestCount: options.getRequestCount(),
      activeShops,
      webhookAuthFailures: ops.webhookAuthFailures,
      outboundDeliveryFailures: ops.outboundDeliveryFailures,
      rateLimitBlocks: ops.rateLimitBlocks,
      spamBlocks: ops.spamBlocks,
    };
  });
};

export default metricsRoutes;
