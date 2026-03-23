import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;

function applyBaseEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.PORT = process.env.PORT || '3000';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/shopfront?schema=public';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'ACxxxxxxxx';
  process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'twilio-token';
  process.env.TWILIO_SMS_NUMBER = process.env.TWILIO_SMS_NUMBER || '+15550000001';
  process.env.TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || '+15550000002';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'gemini-key';
  process.env.SENTRY_DSN = process.env.SENTRY_DSN || 'https://public@sentry.io/1';
  process.env.BASE_URL = process.env.BASE_URL || 'https://example.com';
  process.env.ENABLE_TELEGRAM = 'true';
  process.env.TELEGRAM_BOT_TOKEN = 'telegram-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram-secret';
  process.env.TELEGRAM_BOT_USERNAME = 'shopfront_agent_bot';
  process.env.SKIP_TELEGRAM_VALIDATION = 'false';
  process.env.SKIP_TWILIO_SEND = 'true';
}

function loadMessagingModules() {
  applyBaseEnv();

  for (const mod of ['../src/config', '../src/services/telegramMessaging', '../src/services/messaging']) {
    const p = require.resolve(mod);
    delete require.cache[p];
  }

  const { sendTelegramMessage } = require('../src/services/telegramMessaging') as {
    sendTelegramMessage: (input: { chatId: string; text: string; mediaUrl?: string }) => Promise<string>;
  };

  const { sendMessage } = require('../src/services/messaging') as {
    sendMessage: (input: { to: string; body: string; channel: 'telegram'; mediaUrl?: string }) => Promise<string>;
  };

  const { MessagingError } = require('../src/lib/errors') as {
    MessagingError: new (message: string) => Error;
  };

  return { sendTelegramMessage, sendMessage, MessagingError };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('sendTelegramMessage sends text message via Telegram API', async () => {
  const { sendTelegramMessage } = loadMessagingModules();

  let requestedUrl = '';
  let requestedBody = '';

  globalThis.fetch = (async (url: string | URL | globalThis.Request, init?: RequestInit) => {
    requestedUrl = String(url);
    requestedBody = String(init?.body ?? '');

    return new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 12345 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const sid = await sendTelegramMessage({
    chatId: '8052664312',
    text: 'Hello from Shopfront',
  });

  assert.equal(sid, 'TG_12345');
  assert.match(requestedUrl, /\/sendMessage$/);

  const body = JSON.parse(requestedBody) as { chat_id: string; text: string };
  assert.equal(body.chat_id, '8052664312');
  assert.equal(body.text, 'Hello from Shopfront');
});

test('sendTelegramMessage sends media via sendPhoto when mediaUrl is provided', async () => {
  const { sendTelegramMessage } = loadMessagingModules();

  let requestedUrl = '';
  let requestedBody = '';

  globalThis.fetch = (async (url: string | URL | globalThis.Request, init?: RequestInit) => {
    requestedUrl = String(url);
    requestedBody = String(init?.body ?? '');

    return new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 222 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const sid = await sendTelegramMessage({
    chatId: '8052664312',
    text: 'Photo caption',
    mediaUrl: 'https://cdn.example.com/image.webp',
  });

  assert.equal(sid, 'TG_222');
  assert.match(requestedUrl, /\/sendPhoto$/);

  const body = JSON.parse(requestedBody) as { chat_id: string; photo: string; caption: string };
  assert.equal(body.chat_id, '8052664312');
  assert.equal(body.photo, 'https://cdn.example.com/image.webp');
  assert.equal(body.caption, 'Photo caption');
});

test('sendTelegramMessage throws MessagingError on non-2xx response', async () => {
  const { sendTelegramMessage, MessagingError } = loadMessagingModules();

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
      status: 400,
    })) as typeof fetch;

  await assert.rejects(
    () => sendTelegramMessage({ chatId: '999', text: 'hello' }),
    (error: unknown) => {
      assert.ok(error instanceof MessagingError);
      assert.match((error as Error).message, /HTTP 400/i);
      return true;
    },
  );
});

test('sendMessage routes telegram channel through Telegram sender', async () => {
  const { sendMessage } = loadMessagingModules();

  let called = false;

  globalThis.fetch = (async () => {
    called = true;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }), { status: 200 });
  }) as typeof fetch;

  const sid = await sendMessage({
    to: '8052664312',
    body: 'Routed through sendMessage',
    channel: 'telegram',
  });

  assert.equal(sid, 'TG_999');
  assert.equal(called, true);
});
