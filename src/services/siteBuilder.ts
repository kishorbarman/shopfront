import { promises as fs } from 'node:fs';
import path from 'node:path';

import config from '../config';
import logger from '../lib/logger';
import { prisma } from '../lib/prisma';
import { generateShopPage } from '../templates/generator';

function resolveSiteBaseDir(): string {
  const configured = config.SITE_OUTPUT_DIR;
  if (path.isAbsolute(configured)) {
    return configured;
  }

  return path.join(process.cwd(), configured);
}

export function getSiteOutputPath(slug: string): string {
  return path.join(resolveSiteBaseDir(), slug, 'index.html');
}

export async function rebuildSite(shopId: string): Promise<void> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
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
    throw new Error(`Cannot rebuild site: shop not found (${shopId}).`);
  }

  const html = await generateShopPage(shop);
  const outputPath = getSiteOutputPath(shop.slug);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');

  logger.info(
    {
      event: 'site_rebuilt',
      shopId,
      slug: shop.slug,
      outputPath,
    },
    `Rebuilt site for ${shop.name} at /s/${shop.slug}`,
  );
}
