import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function applyBaseEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.PORT = process.env.PORT || '3000';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/shopfront?schema=public';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'ACxxxxxxxx';
  process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'twilio-token';
  process.env.TWILIO_SMS_NUMBER = process.env.TWILIO_SMS_NUMBER || '+15550000001';
  process.env.TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || '+15550000002';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'gemini-key';
  process.env.SENTRY_DSN = process.env.SENTRY_DSN || 'https://public@sentry.io/1';
  process.env.BASE_URL = process.env.BASE_URL || 'https://example.com';
}

function loadModule() {
  applyBaseEnv();

  const modulePath = require.resolve('../src/services/telegramLinking');
  delete require.cache[modulePath];

  return require('../src/services/telegramLinking') as {
    isTelegramLinkCodeRequest: (text: string) => boolean;
    parseTelegramLinkCommand: (text: string) => { command: 'start' | 'help' | 'link'; code?: string } | null;
  };
}

test('parseTelegramLinkCommand parses /start and /help', () => {
  const { parseTelegramLinkCommand } = loadModule();

  assert.deepEqual(parseTelegramLinkCommand('/start'), { command: 'start' });
  assert.deepEqual(parseTelegramLinkCommand('/help'), { command: 'help' });
});

test('parseTelegramLinkCommand parses /link with normalized code', () => {
  const { parseTelegramLinkCommand } = loadModule();

  assert.deepEqual(parseTelegramLinkCommand('/link ab12cd'), {
    command: 'link',
    code: 'AB12CD',
  });
});

test('parseTelegramLinkCommand returns link command without code when missing', () => {
  const { parseTelegramLinkCommand } = loadModule();

  assert.deepEqual(parseTelegramLinkCommand('/link'), { command: 'link', code: undefined });
});

test('parseTelegramLinkCommand ignores non-command text', () => {
  const { parseTelegramLinkCommand } = loadModule();

  assert.equal(parseTelegramLinkCommand('hello there'), null);
});

test('isTelegramLinkCodeRequest matches supported phone prompts', () => {
  const { isTelegramLinkCodeRequest } = loadModule();

  assert.equal(isTelegramLinkCodeRequest('link telegram'), true);
  assert.equal(isTelegramLinkCodeRequest('/link telegram'), true);
  assert.equal(isTelegramLinkCodeRequest('telegram link'), true);
  assert.equal(isTelegramLinkCodeRequest('link my telegram now'), false);
});
