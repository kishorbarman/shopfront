import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;

type App = { inject: (opts: any) => Promise<any>; close: () => Promise<void> };
type SharedRedis = { flushdb: () => Promise<'OK'>; quit: () => Promise<'OK'> };

const redisClients: SharedRedis[] = [];

function applyBaseEnv(overrides: Record<string, string>): void {
  const env = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://shopfront:shopfront@localhost:5432/shopfront?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379/11',
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || 'ACxxxxxxxx',
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || 'twilio-token',
    TWILIO_SMS_NUMBER: process.env.TWILIO_SMS_NUMBER || '+15550000001',
    TWILIO_WHATSAPP_NUMBER: process.env.TWILIO_WHATSAPP_NUMBER || '+15550000002',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'gemini-key',
    BASE_URL: 'https://shopfront.page',
    SENTRY_DSN: process.env.SENTRY_DSN || 'https://public@sentry.io/1',
    ENABLE_TELEGRAM: 'true',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_WEBHOOK_SECRET: 'telegram-secret',
    TELEGRAM_BOT_USERNAME: 'shopfront_agent_bot',
    SKIP_TWILIO_SEND: 'true',
    SKIP_TWILIO_VALIDATION: 'true',
    MOCK_LLM: 'true',
    ...overrides,
  };

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

async function buildServerWithEnv(overrides: Record<string, string>) {
  applyBaseEnv(overrides);

  for (const mod of [
    '../src/config',
    '../src/index',
    '../src/routes/webhook',
    '../src/routes/metrics',
    '../src/lib/telegramAuth',
    '../src/lib/prisma',
    '../src/lib/redis',
    '../src/lib/opsMetrics',
  ]) {
    const p = require.resolve(mod);
    delete require.cache[p];
  }

  const { buildServer } = require('../src/index') as { buildServer: () => Promise<App> };
  const prisma = (require('../src/lib/prisma') as { prisma: any }).prisma;
  const sharedRedis = (require('../src/lib/redis') as { redis: SharedRedis }).redis;
  const { resetOpsMetrics } = require('../src/lib/opsMetrics') as { resetOpsMetrics: () => void };

  resetOpsMetrics();
  await sharedRedis.flushdb();
  redisClients.push(sharedRedis);

  const app = await buildServer();

  return { app, prisma };
}

function telegramPayload(text: string, updateId?: number) {
  const id = updateId ?? Date.now() + Math.floor(Math.random() * 10000);
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      text,
      from: { id: 1001 },
      chat: { id: 1001 },
    },
  };
}

test.afterEach(async () => {
  globalThis.fetch = originalFetch;
});

test.after(async () => {
  for (const client of redisClients) {
    try {
      await client.quit();
    } catch {
      // already closed
    }
  }
});

test('support command path works for telegram', async () => {
  const sentBodies: string[] = [];

  globalThis.fetch = (async (_input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    sentBodies.push(body);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), { status: 200 });
  }) as typeof fetch;

  const { app, prisma } = await buildServerWithEnv({ SKIP_TELEGRAM_VALIDATION: 'true' });

  const response = await app.inject({
    method: 'POST',
    url: '/api/webhook/telegram',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'telegram-secret',
    },
    payload: telegramPayload('/support'),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(sentBodies.some((entry) => entry.includes('Support: I will troubleshoot first')), true);

  await app.close();
  await prisma.$disconnect();
});

test('webhook auth failures are counted in metrics', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })) as typeof fetch;

  const { app, prisma } = await buildServerWithEnv({ SKIP_TELEGRAM_VALIDATION: 'false' });

  const denied = await app.inject({
    method: 'POST',
    url: '/api/webhook/telegram',
    headers: {
      'content-type': 'application/json',
    },
    payload: telegramPayload('/status'),
  });

  assert.equal(denied.statusCode, 403);

  const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(metricsResponse.statusCode, 200);

  const metrics = metricsResponse.json() as { webhookAuthFailures?: number };
  assert.equal((metrics.webhookAuthFailures ?? 0) >= 1, true);

  await app.close();
  await prisma.$disconnect();
});

test('outbound delivery failures are counted and dead-lettered', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, description: 'simulated outbound failure' }), { status: 500 })) as typeof fetch;

  const { app, prisma } = await buildServerWithEnv({ SKIP_TELEGRAM_VALIDATION: 'true' });

  const response = await app.inject({
    method: 'POST',
    url: '/api/webhook/telegram',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'telegram-secret',
    },
    payload: telegramPayload('hi'),
  });

  assert.equal(response.statusCode, 200);

  const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
  const metrics = metricsResponse.json() as { outboundDeliveryFailures?: number };
  assert.equal((metrics.outboundDeliveryFailures ?? 0) >= 1, true);

  const failedOutbound = await prisma.failedMessage.findFirst({
    where: {
      channel: 'telegram',
      processedAt: null,
      errorType: { in: ['MessagingError', 'Error'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  assert.ok(failedOutbound);

  if (failedOutbound?.id) {
    await prisma.failedMessage.delete({ where: { id: failedOutbound.id } });
  }

  await app.close();
  await prisma.$disconnect();
});
