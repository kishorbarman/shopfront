import type { Channel } from '../models/types';
import { redis } from '../lib/redis';

export interface ConversationState {
  mode: 'onboarding' | 'active' | 'awaiting_confirmation';
  onboardingStep?: number;
  pendingAction?: {
    intent: string;
    data: Record<string, any>;
    confirmationMessage: string;
  };
  shopId?: string;
  lastMessageAt: string;
}

export interface HistoryMessage {
  role: 'user' | 'agent';
  content: string;
}

const STATE_TTL_SECONDS = 24 * 60 * 60;
const HISTORY_TTL_SECONDS = 7 * 24 * 60 * 60;
const HISTORY_MAX_ITEMS = 10;

const RATE_LIMIT_TTL_SECONDS = 60 * 60;
const RATE_LIMIT_BY_CHANNEL: Record<Channel, number> = {
  sms: 20,
  whatsapp: 20,
  telegram: 100,
};

const SPAM_WINDOW_SECONDS = 30;
const SPAM_DUPLICATE_LIMIT = 4;

function stateKey(phone: string): string {
  return `state:${phone}`;
}

function historyKey(phone: string): string {
  return `history:${phone}`;
}

function rateKey(phone: string, channel: Channel): string {
  return `rate:${channel}:${phone}`;
}

function spamKey(phone: string, channel: Channel, bodyFingerprint: string): string {
  return `spam:${channel}:${phone}:${bodyFingerprint}`;
}

function normalizeBody(body: string): string {
  return body.trim().replace(/\s+/g, ' ').toLowerCase();
}

function bodyFingerprint(body: string): string {
  const normalized = normalizeBody(body);
  return normalized.length === 0 ? 'empty' : normalized.slice(0, 120);
}

export async function getState(phone: string): Promise<ConversationState | null> {
  const raw = await redis.get(stateKey(phone));
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as ConversationState;
}

export async function setState(phone: string, state: ConversationState): Promise<void> {
  await redis.set(stateKey(phone), JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
}

export async function clearState(phone: string): Promise<void> {
  await redis.del(stateKey(phone));
}

export async function clearConversationData(phone: string): Promise<void> {
  const keys = await redis.keys(`*:${phone}*`);
  const baseKeys = [stateKey(phone), historyKey(phone)];
  if (keys.length > 0) {
    await redis.del(...new Set([...baseKeys, ...keys]));
    return;
  }

  await redis.del(...baseKeys);
}

export async function addMessage(
  phone: string,
  role: 'user' | 'agent',
  content: string,
): Promise<void> {
  const key = historyKey(phone);
  const message: HistoryMessage = { role, content };

  await redis.rpush(key, JSON.stringify(message));
  await redis.ltrim(key, -HISTORY_MAX_ITEMS, -1);
  await redis.expire(key, HISTORY_TTL_SECONDS);
}

export async function getHistory(phone: string): Promise<Array<{ role: string; content: string }>> {
  const records = await redis.lrange(historyKey(phone), 0, -1);
  return records.map((entry) => JSON.parse(entry) as HistoryMessage);
}

export async function checkRateLimit(
  phone: string,
  channel: Channel = 'sms',
): Promise<{ allowed: boolean; remaining: number; limit: number; count: number }> {
  const key = rateKey(phone, channel);
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_TTL_SECONDS);
  }

  const limit = RATE_LIMIT_BY_CHANNEL[channel] ?? RATE_LIMIT_BY_CHANNEL.sms;
  const remaining = Math.max(limit - count, 0);

  return {
    allowed: count <= limit,
    remaining,
    limit,
    count,
  };
}

export async function checkSpamGuard(
  phone: string,
  channel: Channel,
  body: string,
): Promise<{ allowed: boolean; count: number }> {
  const key = spamKey(phone, channel, bodyFingerprint(body));
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, SPAM_WINDOW_SECONDS);
  }

  return {
    allowed: count <= SPAM_DUPLICATE_LIMIT,
    count,
  };
}
