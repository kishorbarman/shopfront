import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;

function applyEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.PORT = process.env.PORT || '3000';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://shopfront:shopfront@localhost:5432/shopfront?schema=public';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';
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
}

let enqueueFailedOutboundMessage: any;
let replayFailedMessages: (limit?: number) => Promise<void>;
let prisma: any;
let redis: { quit: () => Promise<'OK'> };

test.before(async () => {
  applyEnv();

  for (const mod of [
    '../src/config',
    '../src/services/failedMessageQueue',
    '../src/services/failedMessageReplay',
    '../src/lib/prisma',
    '../src/lib/redis',
  ]) {
    const p = require.resolve(mod);
    delete require.cache[p];
  }

  enqueueFailedOutboundMessage = (
    require('../src/services/failedMessageQueue') as { enqueueFailedOutboundMessage: any }
  ).enqueueFailedOutboundMessage;

  replayFailedMessages = (
    require('../src/services/failedMessageReplay') as { replayFailedMessages: (limit?: number) => Promise<void> }
  ).replayFailedMessages;

  prisma = (require('../src/lib/prisma') as { prisma: any }).prisma;
  redis = (require('../src/lib/redis') as { redis: { quit: () => Promise<'OK'> } }).redis;
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  try {
    await redis.quit();
  } catch {
    // ignore close errors for already-disposed clients
  }
  await prisma.$disconnect();
});

test('replayFailedMessages replays queued outbound telegram failures', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })) as typeof fetch;

  const inbound = {
    id: `TG_${Date.now()}`,
    from: `telegram:test-${Date.now()}`,
    to: 'telegram-bot',
    body: 'status',
    mediaUrls: [],
    channel: 'telegram' as const,
    timestamp: new Date(),
    externalUserId: `test-${Date.now()}`,
    externalSpaceId: `test-${Date.now()}`,
  };

  const record = await enqueueFailedOutboundMessage(
    inbound,
    {
      to: inbound.externalSpaceId,
      body: 'Support reply',
      channel: 'telegram',
    },
    new Error('simulated outbound failure'),
    3,
  );

  await replayFailedMessages(25);

  const updated = await prisma.failedMessage.findUnique({ where: { id: record.id } });
  assert.ok(updated?.processedAt, 'failed outbound telegram message should be marked processed after replay');

  await prisma.failedMessage.delete({ where: { id: record.id } });
});
