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
  process.env.REDIS_URL = 'redis://127.0.0.1:6379/13';
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
const originalFetch = globalThis.fetch;

let app: { inject: (opts: any) => Promise<any>; close: () => Promise<void> };
let prisma: any;
let sharedRedis: { quit: () => Promise<unknown> };
let getSiteOutputPath: (slug: string) => string;

function userId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function cleanup(phone: string): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { phone }, select: { id: true, slug: true } });
  if (!shop) return;

  await prisma.messageLog.deleteMany({ where: { shopId: shop.id } });
  await prisma.channelIdentity.deleteMany({ where: { shopId: shop.id } });
  await prisma.notice.deleteMany({ where: { shopId: shop.id } });
  await prisma.hour.deleteMany({ where: { shopId: shop.id } });
  await prisma.service.deleteMany({ where: { shopId: shop.id } });
  await prisma.shop.deleteMany({ where: { id: shop.id } });

  await fs.rm(path.dirname(getSiteOutputPath(shop.slug)), { recursive: true, force: true });
}

function telegramPayload(externalUserId: string, text: string, updateId: number) {
  const numericId = Number(externalUserId);
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      text,
      from: { id: numericId },
      chat: { id: numericId },
    },
  };
}

test.before(async () => {
  for (const mod of [
    '../src/config',
    '../src/index',
    '../src/lib/prisma',
    '../src/services/siteBuilder',
  ]) {
    const p = require.resolve(mod);
    delete require.cache[p];
  }

  const { buildServer } = require('../src/index') as {
    buildServer: () => Promise<{ inject: (opts: any) => Promise<any>; close: () => Promise<void> }>;
  };
  prisma = (require('../src/lib/prisma') as { prisma: any }).prisma;
  sharedRedis = (require('../src/lib/redis') as { redis: { quit: () => Promise<unknown> } }).redis;
  getSiteOutputPath =
    (require('../src/services/siteBuilder') as { getSiteOutputPath: (slug: string) => string }).getSiteOutputPath;

  app = await buildServer();
});

test.beforeEach(async () => {
  await localRedis.flushdb();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 123 },
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

test('telegram onboarding creates shop and site, then update handler mutates data', async () => {
  const externalUserId = userId();
  const phone = `telegram:${externalUserId}`;

  const steps = ['Hi', 'Luna Studio', 'Salon', 'Done'];

  for (let i = 0; i < steps.length; i += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhook/telegram',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET,
      },
      payload: telegramPayload(externalUserId, steps[i], 9000 + i),
    });

    assert.equal(response.statusCode, 200);
  }

  const shop = await prisma.shop.findUnique({ where: { phone } });
  assert.ok(shop);
  assert.equal(shop?.status, 'ACTIVE');
  assert.equal(shop?.slug.startsWith('luna-studio'), true);

  const htmlPath = getSiteOutputPath(shop!.slug);
  const onboardingHtml = await fs.readFile(htmlPath, 'utf8');
  assert.match(onboardingHtml, /Luna Studio/i);

  const updateResponse = await app.inject({
    method: 'POST',
    url: '/api/webhook/telegram',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET,
    },
    payload: telegramPayload(externalUserId, 'Add hair color for $30', 9010),
  });
  assert.equal(updateResponse.statusCode, 200);

  const service = await prisma.service.findFirst({
    where: {
      shopId: shop!.id,
      name: {
        equals: 'Hair Color',
        mode: 'insensitive',
      },
      isActive: true,
    },
  });
  assert.ok(service);
  assert.equal(service?.price.toString(), '30');

  const refreshedHtml = await fs.readFile(htmlPath, 'utf8');
  assert.match(refreshedHtml, /Hair Color/i);
  assert.match(refreshedHtml, /\$30/);

  const log = await prisma.messageLog.findFirst({
    where: {
      phone,
      channel: 'telegram',
      inboundText: 'Add hair color for $30',
    },
    orderBy: { createdAt: 'desc' },
  });

  assert.ok(log);
  assert.equal(log?.status, 'PROCESSED');
  assert.equal(log?.updateApplied, true);
  assert.equal(Boolean(log?.parsedIntent), true);
  assert.equal(Boolean(log?.parsedSummary), true);

  await cleanup(phone);
});
