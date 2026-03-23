import assert from 'node:assert/strict';
import test from 'node:test';
import Redis from 'ioredis';

process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';

const redis = new Redis(process.env.REDIS_URL);
const phone = '+15550009999';

let addMessage: (phone: string, role: 'user' | 'agent', content: string) => Promise<void>;
let checkRateLimit: (
  phone: string,
  channel?: 'sms' | 'whatsapp' | 'telegram',
) => Promise<{ allowed: boolean; remaining: number; limit: number; count: number }>;
let checkSpamGuard: (
  phone: string,
  channel: 'sms' | 'whatsapp' | 'telegram',
  body: string,
) => Promise<{ allowed: boolean; count: number }>;
let clearState: (phone: string) => Promise<void>;
let getHistory: (phone: string) => Promise<Array<{ role: string; content: string }>>;
let getState: (phone: string) => Promise<unknown>;
let setState: (phone: string, state: unknown) => Promise<void>;
let sharedRedisQuit: (() => Promise<'OK'>) | null = null;

test.before(async () => {
  const conversationStateModule = await import('../src/services/conversationState');
  const sharedRedisModule = await import('../src/lib/redis');

  addMessage = conversationStateModule.addMessage;
  checkRateLimit = conversationStateModule.checkRateLimit;
  checkSpamGuard = conversationStateModule.checkSpamGuard;
  clearState = conversationStateModule.clearState;
  getHistory = conversationStateModule.getHistory;
  getState = conversationStateModule.getState;
  setState = conversationStateModule.setState;

  sharedRedisQuit = sharedRedisModule.redis.quit.bind(sharedRedisModule.redis);
});

test.beforeEach(async () => {
  await redis.flushdb();
});

test.after(async () => {
  await redis.flushdb();
  await redis.quit();

  if (sharedRedisQuit) {
    await sharedRedisQuit();
  }
});

test('setState and getState persist conversation state', async () => {
  const state = {
    mode: 'active' as const,
    onboardingStep: 2,
    lastMessageAt: new Date().toISOString(),
    shopId: 'shop-123',
  };

  await setState(phone, state);
  const loaded = await getState(phone);

  assert.deepEqual(loaded, state);
});

test('clearState removes conversation state', async () => {
  await setState(phone, {
    mode: 'onboarding',
    onboardingStep: 1,
    lastMessageAt: new Date().toISOString(),
  });

  await clearState(phone);

  const loaded = await getState(phone);
  assert.equal(loaded, null);
});

test('addMessage and getHistory keep only the last 10 messages', async () => {
  for (let i = 1; i <= 12; i += 1) {
    await addMessage(phone, 'user', `message-${i}`);
  }

  const history = await getHistory(phone);

  assert.equal(history.length, 10);
  assert.equal(history[0]?.content, 'message-3');
  assert.equal(history[9]?.content, 'message-12');
});

test('checkRateLimit enforces SMS at 20 per hour', async () => {
  let lastResult = { allowed: true, remaining: 20, limit: 20, count: 0 };

  for (let i = 1; i <= 20; i += 1) {
    lastResult = await checkRateLimit(phone, 'sms');
  }

  assert.equal(lastResult.allowed, true);
  assert.equal(lastResult.limit, 20);
  assert.equal(lastResult.remaining, 0);

  const blocked = await checkRateLimit(phone, 'sms');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});

test('checkRateLimit allows a higher Telegram threshold', async () => {
  let result = { allowed: true, remaining: 100, limit: 100, count: 0 };

  for (let i = 1; i <= 100; i += 1) {
    result = await checkRateLimit(phone, 'telegram');
  }

  assert.equal(result.allowed, true);
  assert.equal(result.limit, 100);
  assert.equal(result.remaining, 0);

  const blocked = await checkRateLimit(phone, 'telegram');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});

test('checkSpamGuard blocks repeated duplicate payload bursts', async () => {
  let guard = { allowed: true, count: 0 };

  for (let i = 1; i <= 4; i += 1) {
    guard = await checkSpamGuard(phone, 'telegram', 'same payload every time');
  }

  assert.equal(guard.allowed, true);
  assert.equal(guard.count, 4);

  const blocked = await checkSpamGuard(phone, 'telegram', 'same payload every time');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.count, 5);
});
