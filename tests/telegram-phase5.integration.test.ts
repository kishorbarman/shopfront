import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import Redis from 'ioredis';

const require = createRequire(import.meta.url);

function applyEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.PORT = process.env.PORT || '3000';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://shopfront:shopfront@localhost:5432/shopfront?schema=public';
  process.env.REDIS_URL = 'redis://127.0.0.1:6379/14';
  process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'ACxxxxxxxx';
  process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'twilio-token';
  process.env.TWILIO_SMS_NUMBER = process.env.TWILIO_SMS_NUMBER || '+15550000001';
  process.env.TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || '+15550000002';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'gemini-key';
  process.env.SENTRY_DSN = process.env.SENTRY_DSN || 'https://public@sentry.io/1';
  process.env.BASE_URL = process.env.BASE_URL || 'https://shopfront.page';
  process.env.MOCK_LLM = 'true';
  process.env.ENABLE_TELEGRAM = 'true';
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'telegram-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'telegram-secret';
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'shopfront_agent_bot';
  process.env.SKIP_TELEGRAM_VALIDATION = 'true';
  process.env.SKIP_TWILIO_SEND = 'true';
  process.env.SKIP_TWILIO_VALIDATION = 'true';
}

applyEnv();

const localRedis = new Redis(process.env.REDIS_URL);

let app: { close: () => Promise<void>; inject: (opts: any) => Promise<any> };
let prisma: any;
let sharedRedis: { quit: () => Promise<unknown> };
let getState: (key: string) => Promise<any>;
let getHistory: (key: string) => Promise<Array<{ role: string; content: string }>>;
let getSiteOutputPath: (slug: string) => string;

const originalFetch = globalThis.fetch;

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function ensureChannelIdentityTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ChannelIdentity" (
      "id" TEXT PRIMARY KEY,
      "shopId" TEXT NOT NULL,
      "channel" TEXT NOT NULL,
      "phone" TEXT,
      "externalUserId" TEXT,
      "externalSpaceId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "ChannelIdentity_channel_phone_idx" ON "ChannelIdentity"("channel", "phone")',
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "ChannelIdentity_channel_externalUserId_idx" ON "ChannelIdentity"("channel", "externalUserId")',
  );
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "ChannelIdentity_channel_phone_key" ON "ChannelIdentity"("channel", "phone")',
  );
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "ChannelIdentity_channel_externalUserId_key" ON "ChannelIdentity"("channel", "externalUserId")',
  );
}

async function seedTelegramMappedShop(externalUserId: string) {
  const phone = `+1${uniqueSuffix().slice(-10)}`;
  const slug = `telegram-tony-${uniqueSuffix().slice(-6)}`;

  const shop = await prisma.shop.create({
    data: {
      name: "Tony's Barbershop",
      slug,
      category: 'barber',
      phone,
      status: 'ACTIVE',
      address: '742 Evergreen Terrace, Springfield',
    },
  });

  await prisma.service.createMany({
    data: [
      { shopId: shop.id, name: 'Haircut', price: 25, sortOrder: 1, isActive: true },
      { shopId: shop.id, name: 'Fade', price: 30, sortOrder: 2, isActive: true },
    ],
  });

  await prisma.hour.createMany({
    data: [
      { shopId: shop.id, dayOfWeek: 0, openTime: '09:00', closeTime: '17:00', isClosed: true },
      { shopId: shop.id, dayOfWeek: 1, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 2, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 3, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 4, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 5, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 6, openTime: '09:00', closeTime: '17:00', isClosed: false },
    ],
  });

  await prisma.channelIdentity.create({
    data: {
      shopId: shop.id,
      channel: 'telegram',
      externalUserId,
      externalSpaceId: externalUserId,
      phone: `telegram:${externalUserId}`,
    },
  });

  return shop;
}

async function cleanupShop(shopId: string): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { slug: true } });

  await prisma.messageLog.deleteMany({ where: { shopId } });
  await prisma.channelIdentity.deleteMany({ where: { shopId } });
  await prisma.notice.deleteMany({ where: { shopId } });
  await prisma.hour.deleteMany({ where: { shopId } });
  await prisma.service.deleteMany({ where: { shopId } });
  await prisma.shop.deleteMany({ where: { id: shopId } });

  if (shop?.slug) {
    await fs.rm(path.dirname(getSiteOutputPath(shop.slug)), { recursive: true, force: true });
  }
}

test.before(async () => {
  for (const mod of [
    '../src/config',
    '../src/index',
    '../src/lib/prisma',
    '../src/lib/redis',
    '../src/services/conversationState',
    '../src/services/siteBuilder',
  ]) {
    const p = require.resolve(mod);
    delete require.cache[p];
  }

  const { buildServer } = require('../src/index') as {
    buildServer: () => Promise<{ close: () => Promise<void>; inject: (opts: any) => Promise<any> }>;
  };
  const prismaModule = require('../src/lib/prisma') as { prisma: any };
  const redisModule = require('../src/lib/redis') as { redis: { quit: () => Promise<unknown> } };
  const stateModule = require('../src/services/conversationState') as {
    getState: (key: string) => Promise<any>;
    getHistory: (key: string) => Promise<Array<{ role: string; content: string }>>;
  };
  const siteBuilderModule = require('../src/services/siteBuilder') as {
    getSiteOutputPath: (slug: string) => string;
  };

  prisma = prismaModule.prisma;
  sharedRedis = redisModule.redis;
  getState = stateModule.getState;
  getHistory = stateModule.getHistory;
  getSiteOutputPath = siteBuilderModule.getSiteOutputPath;

  await ensureChannelIdentityTable();
  app = await buildServer();
});

test.beforeEach(async () => {
  await localRedis.flushdb();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 1 },
      }),
      { status: 200 },
    )) as typeof fetch;
});

test.afterEach(async () => {
  globalThis.fetch = originalFetch;
});

test.after(async () => {
  await localRedis.flushdb();
  await localRedis.quit();
  await app.close();
  await sharedRedis.quit();
  await prisma.$disconnect();
});

test('telegram webhook uses identity mapping and runs full mutation -> rebuild -> logging pipeline', async () => {
  const externalUserId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const shop = await seedTelegramMappedShop(externalUserId);

  const response = await app.inject({
    method: 'POST',
    url: '/api/webhook/telegram',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET,
    },
    payload: {
      update_id: Number(externalUserId.slice(-6)),
      message: {
        message_id: 111,
        date: Math.floor(Date.now() / 1000),
        text: 'Change haircut to $44',
        from: { id: Number(externalUserId) },
        chat: { id: Number(externalUserId) },
      },
    },
  });

  assert.equal(response.statusCode, 200);

  const updatedHaircut = await prisma.service.findFirst({
    where: {
      shopId: shop.id,
      name: 'Haircut',
      isActive: true,
    },
  });
  assert.equal(updatedHaircut?.price.toString(), '44');

  const htmlPath = getSiteOutputPath(shop.slug);
  const html = await fs.readFile(htmlPath, 'utf8');
  assert.match(html, /Haircut/);
  assert.match(html, /\$44/);

  const state = await getState(`telegram:${externalUserId}`);
  assert.equal(state?.shopId, shop.id);

  const history = await getHistory(`telegram:${externalUserId}`);
  assert.equal(history.length >= 2, true);
  assert.equal(history.at(-2)?.role, 'user');
  assert.equal(history.at(-1)?.role, 'agent');

  const log = await prisma.messageLog.findFirst({
    where: {
      shopId: shop.id,
      channel: 'telegram',
      phone: `telegram:${externalUserId}`,
    },
    orderBy: { createdAt: 'desc' },
  });

  assert.ok(log);
  assert.equal(log?.status, 'PROCESSED');
  assert.equal(log?.updateApplied, true);
  assert.equal(Boolean(log?.parsedIntent), true);
  assert.equal(Boolean(log?.parsedSummary), true);

  await cleanupShop(shop.id);
});
