import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function applyEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.PORT = process.env.PORT || '3000';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://shopfront:shopfront@localhost:5432/shopfront?schema=public';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/12';
  process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'ACxxxxxxxx';
  process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'twilio-token';
  process.env.TWILIO_SMS_NUMBER = process.env.TWILIO_SMS_NUMBER || '+15550000001';
  process.env.TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || '+15550000002';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'gemini-key';
  process.env.SENTRY_DSN = process.env.SENTRY_DSN || 'https://public@sentry.io/1';
  process.env.BASE_URL = process.env.BASE_URL || 'https://shopfront.page';
  process.env.ENABLE_TELEGRAM = 'true';
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'telegram-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'telegram-secret';
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'shopfront_agent_bot';
  process.env.SKIP_TELEGRAM_VALIDATION = 'true';
  process.env.SKIP_TWILIO_SEND = 'true';
  process.env.SKIP_TWILIO_VALIDATION = 'true';
  process.env.MOCK_LLM = 'true';
}

applyEnv();

let app: { inject: (opts: any) => Promise<any>; close: () => Promise<void> };
let prisma: { $disconnect: () => Promise<void> };
let sharedRedis: { quit: () => Promise<unknown> };

const originalFetch = globalThis.fetch;

test.before(async () => {
  for (const mod of ['../src/config', '../src/index']) {
    const p = require.resolve(mod);
    delete require.cache[p];
  }

  const { buildServer } = require('../src/index') as {
    buildServer: () => Promise<{ inject: (opts: any) => Promise<any>; close: () => Promise<void> }>;
  };
  prisma = (require('../src/lib/prisma') as { prisma: { $disconnect: () => Promise<void> } }).prisma;
  sharedRedis = (require('../src/lib/redis') as { redis: { quit: () => Promise<unknown> } }).redis;

  app = await buildServer();
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  await sharedRedis.quit();
  await prisma.$disconnect();
});

test('telegram webhook returns ignored for unsupported updates', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })) as typeof fetch;

  const response = await app.inject({
    method: 'POST',
    url: '/api/webhook/telegram',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET,
    },
    payload: {
      update_id: 999111,
      inline_query: {
        id: 'ignored',
      },
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { ok?: boolean; ignored?: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.ignored, true);
});
