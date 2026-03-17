import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { DatabaseError, ValidationError } from '../lib/errors';
import logger from '../lib/logger';
import { getSiteOutputPath, rebuildSite } from './siteBuilder';

type ServiceUpdates = {
  newPrice?: number;
  newName?: string;
};

type HourChange = {
  dayOfWeek: number;
  openTime?: string;
  closeTime?: string;
  isClosed?: boolean;
};

type NoticeInput = {
  message: string;
  type: 'info' | 'warning' | 'closure';
  startsAt: string;
  expiresAt?: string;
};

const PLACEHOLDER_SERVICE_NAME = 'Services coming soon';

function assertNonEmpty(value: string, field: string): void {
  if (!value || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[m][n];
}

function wrapDatabaseError(error: unknown): DatabaseError {
  const typedError = error instanceof Error ? error : new Error(String(error));
  return new DatabaseError(typedError.message);
}

function logMutation(shopId: string, intent: string, success: boolean): void {
  logger.info(
    {
      event: 'shop_updated',
      shopId,
      intent,
      success,
    },
    success ? 'Shop mutation succeeded' : 'Shop mutation failed',
  );
}

async function touchShop(shopId: string): Promise<void> {
  try {
    await prisma.shop.update({
      where: { id: shopId },
      data: { updatedAt: new Date() },
    });
  } catch (error) {
    throw wrapDatabaseError(error);
  }
}

async function touchAndRebuild(shopId: string): Promise<void> {
  await touchShop(shopId);
  await rebuildSite(shopId);
}

async function findServiceByFuzzyName(shopId: string, serviceName: string) {
  assertNonEmpty(serviceName, 'serviceName');

  let services;
  try {
    services = await prisma.service.findMany({
      where: { shopId, isActive: true },
    });
  } catch (error) {
    throw wrapDatabaseError(error);
  }

  if (services.length === 0) {
    return null;
  }

  const target = normalize(serviceName);

  const exact = services.find((service) => normalize(service.name) === target);
  if (exact) {
    return exact;
  }

  const contains = services.find(
    (service) => normalize(service.name).includes(target) || target.includes(normalize(service.name)),
  );
  if (contains) {
    return contains;
  }

  const ranked = services
    .map((service) => ({
      service,
      distance: levenshtein(target, normalize(service.name)),
    }))
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  if (!best) {
    return null;
  }

  const threshold = Math.max(2, Math.floor(target.length * 0.4));
  return best.distance <= threshold ? best.service : null;
}

export async function addService(
  shopId: string,
  input: { name: string; price: number; description?: string },
) {
  assertNonEmpty(input.name, 'name');
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new ValidationError('price must be a positive number.');
  }

  try {
    await prisma.service.updateMany({
      where: {
        shopId,
        isActive: true,
        name: {
          equals: PLACEHOLDER_SERVICE_NAME,
          mode: 'insensitive',
        },
      },
      data: {
        isActive: false,
      },
    });

    const maxSort = await prisma.service.aggregate({
      where: { shopId },
      _max: { sortOrder: true },
    });

    const created = await prisma.service.create({
      data: {
        shopId,
        name: input.name.trim(),
        price: new Prisma.Decimal(input.price),
        description: input.description?.trim() || null,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        isActive: true,
      },
    });

    await touchAndRebuild(shopId);
    logMutation(shopId, 'add_service', true);
    return created;
  } catch (error) {
    logMutation(shopId, 'add_service', false);
    if (error instanceof ValidationError || error instanceof DatabaseError) {
      throw error;
    }
    throw wrapDatabaseError(error);
  }
}

export async function updateService(shopId: string, serviceName: string, updates: ServiceUpdates) {
  const service = await findServiceByFuzzyName(shopId, serviceName);
  if (!service) {
    throw new ValidationError(`Service not found: ${serviceName}`);
  }

  if (updates.newPrice !== undefined && (!Number.isFinite(updates.newPrice) || updates.newPrice <= 0)) {
    throw new ValidationError('newPrice must be a positive number.');
  }

  if (updates.newName !== undefined) {
    assertNonEmpty(updates.newName, 'newName');
  }

  try {
    const updated = await prisma.service.update({
      where: { id: service.id },
      data: {
        name: updates.newName?.trim() ?? undefined,
        price: updates.newPrice !== undefined ? new Prisma.Decimal(updates.newPrice) : undefined,
      },
    });

    await touchAndRebuild(shopId);
    logMutation(shopId, 'update_service', true);
    return updated;
  } catch (error) {
    logMutation(shopId, 'update_service', false);
    throw wrapDatabaseError(error);
  }
}

export async function removeService(shopId: string, serviceName: string) {
  const service = await findServiceByFuzzyName(shopId, serviceName);
  if (!service) {
    throw new ValidationError(`Service not found: ${serviceName}`);
  }

  try {
    const updated = await prisma.service.update({
      where: { id: service.id },
      data: { isActive: false },
    });

    await touchAndRebuild(shopId);
    logMutation(shopId, 'remove_service', true);
    return updated;
  } catch (error) {
    logMutation(shopId, 'remove_service', false);
    throw wrapDatabaseError(error);
  }
}

export async function updateHours(shopId: string, changes: HourChange[]) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new ValidationError('changes must include at least one hour update.');
  }

  const updates = [] as Array<Awaited<ReturnType<typeof prisma.hour.upsert>>>;

  try {
    for (const change of changes) {
      if (!Number.isInteger(change.dayOfWeek) || change.dayOfWeek < 0 || change.dayOfWeek > 6) {
        throw new ValidationError(`Invalid dayOfWeek: ${change.dayOfWeek}`);
      }

      const inferredIsClosed =
        change.isClosed !== undefined
          ? change.isClosed
          : change.openTime || change.closeTime
            ? false
            : undefined;

      const record = await prisma.hour.upsert({
        where: {
          shopId_dayOfWeek: {
            shopId,
            dayOfWeek: change.dayOfWeek,
          },
        },
        update: {
          openTime: change.openTime,
          closeTime: change.closeTime,
          isClosed: inferredIsClosed,
        },
        create: {
          shopId,
          dayOfWeek: change.dayOfWeek,
          openTime: change.openTime ?? '09:00',
          closeTime: change.closeTime ?? '17:00',
          isClosed: inferredIsClosed ?? false,
        },
      });

      updates.push(record);
    }

    await touchAndRebuild(shopId);
    logMutation(shopId, 'update_hours', true);
    return updates;
  } catch (error) {
    logMutation(shopId, 'update_hours', false);
    if (error instanceof ValidationError) {
      throw error;
    }
    throw wrapDatabaseError(error);
  }
}

function toNoticeType(type: NoticeInput['type']): 'INFO' | 'WARNING' | 'CLOSURE' {
  if (type === 'warning') return 'WARNING';
  if (type === 'closure') return 'CLOSURE';
  return 'INFO';
}

export async function addNotice(shopId: string, input: NoticeInput) {
  assertNonEmpty(input.message, 'message');

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    throw new ValidationError('startsAt must be a valid ISO datetime.');
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError('expiresAt must be a valid ISO datetime.');
    }
    expiresAt = parsed;
  }

  try {
    const notice = await prisma.notice.create({
      data: {
        shopId,
        message: input.message.trim(),
        type: toNoticeType(input.type),
        startsAt,
        expiresAt,
      },
    });

    await touchAndRebuild(shopId);
    logMutation(shopId, 'add_notice', true);
    return notice;
  } catch (error) {
    logMutation(shopId, 'add_notice', false);
    throw wrapDatabaseError(error);
  }
}

export async function removeNotice(shopId: string, noticeId: string) {
  assertNonEmpty(noticeId, 'noticeId');

  try {
    const existing = await prisma.notice.findFirst({
      where: {
        id: noticeId,
        shopId,
      },
    });

    if (!existing) {
      throw new ValidationError(`Notice not found: ${noticeId}`);
    }

    const deleted = await prisma.notice.delete({
      where: { id: noticeId },
    });

    await touchAndRebuild(shopId);
    logMutation(shopId, 'remove_notice', true);
    return deleted;
  } catch (error) {
    logMutation(shopId, 'remove_notice', false);
    if (error instanceof ValidationError) {
      throw error;
    }
    throw wrapDatabaseError(error);
  }
}

export async function updateContact(shopId: string, field: 'phone' | 'address', value: string) {
  assertNonEmpty(value, 'value');

  try {
    const updated = await prisma.shop.update({
      where: { id: shopId },
      data: {
        ...(field === 'phone' ? { phone: value.trim() } : { address: value.trim() }),
      },
    });

    await touchShop(shopId);
    if (field === 'address') {
      await rebuildSite(shopId);
    }

    logMutation(shopId, 'update_contact', true);
    return updated;
  } catch (error) {
    logMutation(shopId, 'update_contact', false);
    throw wrapDatabaseError(error);
  }
}

export async function deleteWebsiteAndData(shop: { id: string; phone: string; slug: string }): Promise<void> {
  assertNonEmpty(shop.id, 'shopId');
  assertNonEmpty(shop.phone, 'phone');
  assertNonEmpty(shop.slug, 'slug');

  try {
    await prisma.$transaction(async (tx) => {
      await tx.service.deleteMany({ where: { shopId: shop.id } });
      await tx.hour.deleteMany({ where: { shopId: shop.id } });
      await tx.notice.deleteMany({ where: { shopId: shop.id } });
      await tx.messageLog.deleteMany({ where: { OR: [{ shopId: shop.id }, { phone: shop.phone }] } });
      await tx.failedMessage.deleteMany({ where: { phone: shop.phone } });
      await tx.shop.delete({ where: { id: shop.id } });
    });

    await fs.rm(getSiteOutputPath(shop.slug), { recursive: true, force: true });
    await fs.rm(path.join(process.cwd(), 'public', 'uploads', shop.id), {
      recursive: true,
      force: true,
    });

    logMutation(shop.id, 'delete_website', true);
  } catch (error) {
    logMutation(shop.id, 'delete_website', false);
    throw wrapDatabaseError(error);
  }
}

export async function findActiveService(shopId: string, serviceName: string) {
  return findServiceByFuzzyName(shopId, serviceName);
}
