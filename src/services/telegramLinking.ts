import { randomInt } from 'node:crypto';

const LINK_CODE_TTL_SECONDS = 10 * 60;
const LINK_CODE_LENGTH = 6;
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function codeKey(code: string): string {
  return `telegram:link:${code}`;
}

function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

function generateCode(): string {
  let result = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) {
    result += LINK_ALPHABET[randomInt(0, LINK_ALPHABET.length)];
  }
  return result;
}

async function loadRedis() {
  const { redis } = await import('../lib/redis');
  return redis;
}

export async function createTelegramLinkCode(shopId: string): Promise<string> {
  const redis = await loadRedis();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCode();
    const setResult = await redis.set(codeKey(code), shopId, 'EX', LINK_CODE_TTL_SECONDS, 'NX');
    if (setResult === 'OK') {
      return code;
    }
  }

  throw new Error('Could not allocate a Telegram link code.');
}

export async function consumeTelegramLinkCode(code: string): Promise<string | null> {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return null;
  }

  const redis = await loadRedis();
  const key = codeKey(normalized);
  const shopId = await redis.get(key);
  if (!shopId) {
    return null;
  }

  await redis.del(key);
  return shopId;
}

export type TelegramCommand = 'start' | 'help' | 'link' | 'status' | 'site' | 'support';

export function parseTelegramLinkCommand(
  text: string,
): { command: TelegramCommand; code?: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const [commandRaw, maybeCode] = trimmed.split(/\s+/, 2);
  const command = commandRaw.toLowerCase();

  if (command === '/start') {
    return { command: 'start' };
  }

  if (command === '/help') {
    return { command: 'help' };
  }

  if (command === '/status') {
    return { command: 'status' };
  }

  if (command === '/site') {
    return { command: 'site' };
  }

  if (command === '/support') {
    return { command: 'support' };
  }

  if (command === '/link') {
    return {
      command: 'link',
      code: maybeCode ? normalizeCode(maybeCode) : undefined,
    };
  }

  return null;
}

export function isTelegramLinkCodeRequest(text: string): boolean {
  return /^(\/link\s+telegram|link\s+telegram|telegram\s+link)$/i.test(text.trim());
}
