import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/shopfront?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    TWILIO_ACCOUNT_SID: 'ACxxxxxxxx',
    TWILIO_AUTH_TOKEN: 'twilio-token',
    TWILIO_SMS_NUMBER: '+15550000001',
    TWILIO_WHATSAPP_NUMBER: '+15550000002',
    GEMINI_API_KEY: 'gemini-key',
    SENTRY_DSN: 'https://public@sentry.io/1',
    BASE_URL: 'https://example.com',
    SITE_OUTPUT_DIR: 'public/sites',
    SKIP_TWILIO_VALIDATION: 'false',
    SKIP_TWILIO_SEND: 'false',
    MOCK_LLM: 'false',
    ENABLE_TELEGRAM: 'false',
    SKIP_TELEGRAM_VALIDATION: 'false',
  };
}

test('loadConfig does not require telegram vars when telegram is disabled', () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.ENABLE_TELEGRAM, false);
  assert.equal(config.TELEGRAM_BOT_TOKEN, '');
  assert.equal(config.TELEGRAM_WEBHOOK_SECRET, '');
  assert.equal(config.TELEGRAM_BOT_USERNAME, '');
});

test('loadConfig requires telegram vars when telegram is enabled', () => {
  const env = {
    ...baseEnv(),
    ENABLE_TELEGRAM: 'true',
  };

  assert.throws(
    () => loadConfig(env),
    /TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|TELEGRAM_BOT_USERNAME/,
  );
});

test('loadConfig allows missing telegram secret only when skip validation is true', () => {
  const env = {
    ...baseEnv(),
    ENABLE_TELEGRAM: 'true',
    SKIP_TELEGRAM_VALIDATION: 'true',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_BOT_USERNAME: 'shopfront_bot',
  };

  const config = loadConfig(env);
  assert.equal(config.ENABLE_TELEGRAM, true);
  assert.equal(config.SKIP_TELEGRAM_VALIDATION, true);
  assert.equal(config.TELEGRAM_WEBHOOK_SECRET, '');
});

test('loadConfig accepts telegram vars when enabled', () => {
  const env = {
    ...baseEnv(),
    ENABLE_TELEGRAM: 'true',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_WEBHOOK_SECRET: 'secret-token',
    TELEGRAM_BOT_USERNAME: 'shopfront_bot',
  };

  const config = loadConfig(env);
  assert.equal(config.ENABLE_TELEGRAM, true);
  assert.equal(config.TELEGRAM_BOT_TOKEN, 'telegram-token');
  assert.equal(config.TELEGRAM_WEBHOOK_SECRET, 'secret-token');
  assert.equal(config.TELEGRAM_BOT_USERNAME, 'shopfront_bot');
});
