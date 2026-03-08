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
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_TTL_SECONDS = 60 * 60;

function stateKey(phone: string): string {
  return `state:${phone}`;
}

function historyKey(phone: string): string {
  return `history:${phone}`;
}

function rateKey(phone: string): string {
  return `rate:${phone}`;
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
): Promise<{ allowed: boolean; remaining: number }> {
  const key = rateKey(phone);
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_TTL_SECONDS);
  }

  const remaining = Math.max(RATE_LIMIT_MAX - count, 0);
  return {
    allowed: count <= RATE_LIMIT_MAX,
    remaining,
  };
}
