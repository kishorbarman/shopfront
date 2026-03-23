import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseTelegramUpdate,
  telegramIdempotencyKey,
  validateTelegramWebhookSignature,
} from '../src/lib/telegramAuth';

test('validateTelegramWebhookSignature returns true for matching secret', () => {
  const valid = validateTelegramWebhookSignature(
    { 'x-telegram-bot-api-secret-token': 'abc123' },
    'abc123',
    false,
  );

  assert.equal(valid, true);
});

test('validateTelegramWebhookSignature returns false for missing secret header', () => {
  const valid = validateTelegramWebhookSignature({}, 'abc123', false);
  assert.equal(valid, false);
});

test('validateTelegramWebhookSignature can be bypassed in local mode', () => {
  const valid = validateTelegramWebhookSignature({}, 'abc123', true);
  assert.equal(valid, true);
});

test('parseTelegramUpdate parses standard message payload', () => {
  const parsed = parseTelegramUpdate({
    update_id: 1001,
    message: {
      message_id: 55,
      date: 1_710_000_000,
      text: 'Hi Shopfront',
      from: { id: 987654321 },
      chat: { id: 123456789 },
    },
  });

  assert.ok(parsed);
  assert.equal(parsed?.updateId, '1001');
  assert.equal(parsed?.messageId, '55');
  assert.equal(parsed?.externalUserId, '987654321');
  assert.equal(parsed?.externalSpaceId, '123456789');
  assert.equal(parsed?.body, 'Hi Shopfront');
  assert.equal(parsed?.timestamp.toISOString(), new Date(1_710_000_000 * 1000).toISOString());
});

test('parseTelegramUpdate parses callback_query payload', () => {
  const parsed = parseTelegramUpdate({
    update_id: 1002,
    callback_query: {
      id: 'cbq_1',
      data: 'confirm',
      from: { id: 111222333 },
      message: {
        message_id: 77,
        date: 1_710_000_001,
        chat: { id: 444555666 },
      },
    },
  });

  assert.ok(parsed);
  assert.equal(parsed?.updateId, '1002');
  assert.equal(parsed?.messageId, 'cbq_1');
  assert.equal(parsed?.externalUserId, '111222333');
  assert.equal(parsed?.externalSpaceId, '444555666');
  assert.equal(parsed?.body, 'confirm');
});

test('parseTelegramUpdate returns null for unsupported payload', () => {
  const parsed = parseTelegramUpdate({ update_id: 1003 });
  assert.equal(parsed, null);
});

test('telegramIdempotencyKey is deterministic', () => {
  assert.equal(telegramIdempotencyKey('1001'), 'telegram:update:1001');
});
