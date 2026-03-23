import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export type TelegramUser = {
  id: number | string;
};

export type TelegramChat = {
  id: number | string;
};

export type TelegramMessage = {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat?: TelegramChat;
};

export type TelegramCallbackQuery = {
  id?: string;
  data?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type ParsedTelegramUpdate = {
  updateId: string;
  messageId: string;
  externalUserId: string;
  externalSpaceId: string;
  body: string;
  timestamp: Date;
};

function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateTelegramWebhookSignature(
  headers: IncomingHttpHeaders,
  expectedSecret: string,
  skipValidation: boolean,
): boolean {
  if (skipValidation) {
    return true;
  }

  const actualSecret = readHeaderValue(headers['x-telegram-bot-api-secret-token']).trim();
  if (!actualSecret || !expectedSecret) {
    return false;
  }

  return secureEquals(actualSecret, expectedSecret.trim());
}

export function parseTelegramUpdate(update: TelegramUpdate): ParsedTelegramUpdate | null {
  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  const callback = update.callback_query;

  const fromId =
    message?.from?.id ??
    callback?.from?.id ??
    callback?.message?.from?.id;
  const chatId = message?.chat?.id ?? callback?.message?.chat?.id;

  if (fromId === undefined || chatId === undefined) {
    return null;
  }

  const body = (message?.text ?? message?.caption ?? callback?.data ?? '').trim();
  const dateUnix = message?.date ?? callback?.message?.date;
  const timestamp = dateUnix ? new Date(dateUnix * 1000) : new Date();

  const updateId = String(update.update_id ?? message?.message_id ?? callback?.id ?? Date.now());
  const messageId = String(message?.message_id ?? callback?.id ?? updateId);

  return {
    updateId,
    messageId,
    externalUserId: String(fromId),
    externalSpaceId: String(chatId),
    body,
    timestamp,
  };
}

export function telegramIdempotencyKey(updateId: string): string {
  return `telegram:update:${updateId}`;
}
