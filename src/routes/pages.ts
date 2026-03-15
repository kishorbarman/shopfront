import { promises as fs } from 'node:fs';

import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../lib/prisma';
import { rebuildSite, getSiteOutputPath } from '../services/siteBuilder';
import { generateShopPage } from '../templates/generator';

function buildEtag(updatedAt: Date, payloadBytes: number): string {
  return `W/"${updatedAt.getTime()}-${payloadBytes}"`;
}

async function readPrebuiltSite(slug: string): Promise<string | null> {
  const filePath = getSiteOutputPath(slug);

  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

const pagesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { slug: string } }>('/s/:slug', async (request, reply) => {
    const shopMeta = await prisma.shop.findUnique({
      where: { slug: request.params.slug },
      select: {
        id: true,
        slug: true,
        updatedAt: true,
      },
    });

    if (!shopMeta) {
      reply.code(404).type('text/html; charset=utf-8').send('<h1>Shop not found</h1>');
      return;
    }

    let html = await readPrebuiltSite(shopMeta.slug);
    if (!html) {
      await rebuildSite(shopMeta.id);
      html = await readPrebuiltSite(shopMeta.slug);
    }

    if (!html) {
      const shop = await prisma.shop.findUnique({
        where: { id: shopMeta.id },
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
          logs: {
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
        },
      });

      if (!shop) {
        reply.code(404).type('text/html; charset=utf-8').send('<h1>Shop not found</h1>');
        return;
      }

      html = await generateShopPage(shop);
      await rebuildSite(shop.id);
    }

    const payloadBytes = Buffer.byteLength(html, 'utf8');

    reply
      .header('Cache-Control', 'public, max-age=300')
      .header('Last-Modified', shopMeta.updatedAt.toUTCString())
      .header('ETag', buildEtag(shopMeta.updatedAt, payloadBytes))
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
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
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
