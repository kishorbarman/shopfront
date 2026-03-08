import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';

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

function assertNonEmpty(value: string, field: string): void {
  if (!value || !value.trim()) {
    throw new Error(`${field} is required.`);
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

async function touchShop(shopId: string): Promise<void> {
  await prisma.shop.update({
    where: { id: shopId },
    data: { updatedAt: new Date() },
  });
}

async function findServiceByFuzzyName(shopId: string, serviceName: string) {
  assertNonEmpty(serviceName, 'serviceName');

  const services = await prisma.service.findMany({
    where: { shopId, isActive: true },
  });

  if (services.length === 0) {
    return null;
  }

  const target = normalize(serviceName);

  const exact = services.find((service) => normalize(service.name) === target);
  if (exact) {
    return exact;
  }

  const contains = services.find((service) => normalize(service.name).includes(target) || target.includes(normalize(service.name)));
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
    throw new Error('price must be a positive number.');
  }

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

  await touchShop(shopId);
  return created;
}

export async function updateService(shopId: string, serviceName: string, updates: ServiceUpdates) {
  const service = await findServiceByFuzzyName(shopId, serviceName);
  if (!service) {
    throw new Error(`Service not found: ${serviceName}`);
  }

  if (updates.newPrice !== undefined && (!Number.isFinite(updates.newPrice) || updates.newPrice <= 0)) {
    throw new Error('newPrice must be a positive number.');
  }

  if (updates.newName !== undefined) {
    assertNonEmpty(updates.newName, 'newName');
  }

  const updated = await prisma.service.update({
    where: { id: service.id },
    data: {
      name: updates.newName?.trim() ?? undefined,
      price: updates.newPrice !== undefined ? new Prisma.Decimal(updates.newPrice) : undefined,
    },
  });

  await touchShop(shopId);
  return updated;
}

export async function removeService(shopId: string, serviceName: string) {
  const service = await findServiceByFuzzyName(shopId, serviceName);
  if (!service) {
    throw new Error(`Service not found: ${serviceName}`);
  }

  const updated = await prisma.service.update({
    where: { id: service.id },
    data: { isActive: false },
  });

  await touchShop(shopId);
  return updated;
}

export async function updateHours(shopId: string, changes: HourChange[]) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('changes must include at least one hour update.');
  }

  const updates = [] as Array<Awaited<ReturnType<typeof prisma.hour.upsert>>>;

  for (const change of changes) {
    if (!Number.isInteger(change.dayOfWeek) || change.dayOfWeek < 0 || change.dayOfWeek > 6) {
      throw new Error(`Invalid dayOfWeek: ${change.dayOfWeek}`);
    }

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
        isClosed: change.isClosed,
      },
      create: {
        shopId,
        dayOfWeek: change.dayOfWeek,
        openTime: change.openTime ?? '09:00',
        closeTime: change.closeTime ?? '17:00',
        isClosed: change.isClosed ?? false,
      },
    });

    updates.push(record);
  }

  await touchShop(shopId);
  return updates;
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
    throw new Error('startsAt must be a valid ISO datetime.');
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('expiresAt must be a valid ISO datetime.');
    }
    expiresAt = parsed;
  }

  const notice = await prisma.notice.create({
    data: {
      shopId,
      message: input.message.trim(),
      type: toNoticeType(input.type),
      startsAt,
      expiresAt,
    },
  });

  await touchShop(shopId);
  return notice;
}

export async function removeNotice(shopId: string, noticeId: string) {
  assertNonEmpty(noticeId, 'noticeId');

  const existing = await prisma.notice.findFirst({
    where: {
      id: noticeId,
      shopId,
    },
  });

  if (!existing) {
    throw new Error(`Notice not found: ${noticeId}`);
  }

  const deleted = await prisma.notice.delete({
    where: { id: noticeId },
  });

  await touchShop(shopId);
  return deleted;
}

export async function updateContact(shopId: string, field: 'phone' | 'address', value: string) {
  assertNonEmpty(value, 'value');

  const updated = await prisma.shop.update({
    where: { id: shopId },
    data: {
      ...(field === 'phone' ? { phone: value.trim() } : { address: value.trim() }),
    },
  });

  await touchShop(shopId);
  return updated;
}

export async function findActiveService(shopId: string, serviceName: string) {
  return findServiceByFuzzyName(shopId, serviceName);
}
