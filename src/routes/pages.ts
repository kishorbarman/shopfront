import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../lib/prisma';
import { generateShopPage } from '../templates/generator';

const pagesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { slug: string } }>('/s/:slug', async (request, reply) => {
    const shop = await prisma.shop.findUnique({
      where: { slug: request.params.slug },
      include: {
        services: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        hours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        notices: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!shop) {
      reply.code(404).type('text/html; charset=utf-8').send('<h1>Shop not found</h1>');
      return;
    }

    const html = await generateShopPage(shop);
    reply
      .header('Cache-Control', 'public, max-age=300')
      .type('text/html; charset=utf-8')
      .send(html);
  });

  fastify.get<{ Params: { shopId: string } }>('/preview/:shopId', async (request, reply) => {
    const shop = await prisma.shop.findUnique({
      where: { id: request.params.shopId },
      include: {
        services: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        hours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        notices: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!shop) {
      reply.code(404).type('text/html; charset=utf-8').send('<h1>Shop not found</h1>');
      return;
    }

    const html = await generateShopPage(shop);
    reply
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(html);
  });
};

export default pagesRoutes;
