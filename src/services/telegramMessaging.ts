import config from '../config';
import { MessagingError } from '../lib/errors';
import logger from '../lib/logger';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

type TelegramApiSuccess = {
  ok: true;
  result: {
    message_id?: number;
  };
};

type TelegramApiFailure = {
  ok: false;
  description?: string;
  error_code?: number;
};

type TelegramApiResponse = TelegramApiSuccess | TelegramApiFailure;

type SendTelegramMessageInput = {
  chatId: string;
  text: string;
  mediaUrl?: string;
};

function getTelegramToken(): string {
  const token = config.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new MessagingError('TELEGRAM_BOT_TOKEN must be set for Telegram messaging.');
  }
  return token;
}

function buildTelegramRequest(input: SendTelegramMessageInput): {
  endpoint: string;
  payload: Record<string, unknown>;
} {
  if (input.mediaUrl) {
    return {
      endpoint: 'sendPhoto',
      payload: {
        chat_id: input.chatId,
        photo: input.mediaUrl,
        caption: input.text,
      },
    };
  }

  return {
    endpoint: 'sendMessage',
    payload: {
      chat_id: input.chatId,
      text: input.text,
    },
  };
}

export async function sendTelegramMessage(input: SendTelegramMessageInput): Promise<string> {
  const token = getTelegramToken();
  const { endpoint, payload } = buildTelegramRequest(input);
  const url = `${TELEGRAM_API_BASE}/bot${token}/${endpoint}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let data: TelegramApiResponse | null = null;

    try {
      data = raw ? (JSON.parse(raw) as TelegramApiResponse) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const description = data && 'description' in data ? data.description : undefined;
      throw new MessagingError(
        `Telegram send failed with HTTP ${response.status}${description ? `: ${description}` : ''}`,
      );
    }

    if (!data || !data.ok) {
      const description = data && 'description' in data ? data.description : 'Unknown Telegram API response';
      throw new MessagingError(`Telegram send failed: ${description}`);
    }

    const telegramMessageId = data.result?.message_id;
    const sid = telegramMessageId !== undefined ? `TG_${telegramMessageId}` : `TG_${Date.now()}`;

    logger.info(
      {
        event: 'message_sent',
        id: sid,
        phone: input.chatId,
        channel: 'telegram',
        bodyLength: input.text.length,
        hasMedia: Boolean(input.mediaUrl),
      },
      'Outbound Telegram message sent',
    );

    return sid;
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));

    logger.error(
      {
        event: 'error',
        type: 'MessagingError',
        channel: 'telegram',
        phone: input.chatId,
        message: typedError.message,
        stack: typedError.stack,
      },
      'Failed to send outbound Telegram message',
    );

    throw typedError instanceof MessagingError
      ? typedError
      : new MessagingError(`Telegram send failed: ${typedError.message}`);
  }
}

export async function deleteTelegramMessage(input: { chatId: string; messageId: string | number }): Promise<void> {
  const token = getTelegramToken();
  const url = `${TELEGRAM_API_BASE}/bot${token}/deleteMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        message_id: Number(input.messageId),
      }),
    });

    const raw = await response.text();
    let data: TelegramApiResponse | null = null;

    try {
      data = raw ? (JSON.parse(raw) as TelegramApiResponse) : null;
    } catch {
      data = null;
    }

    if (!response.ok || !data || !data.ok) {
      const description = data && 'description' in data ? data.description : undefined;
      throw new MessagingError(
        `Telegram deleteMessage failed${response.ok ? '' : ` with HTTP ${response.status}`}${
          description ? `: ${description}` : ''
        }`,
      );
    }

    logger.info(
      {
        event: 'telegram_message_deleted',
        channel: 'telegram',
        phone: input.chatId,
        messageId: String(input.messageId),
      },
      'Deleted duplicate Telegram message',
    );
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));

    logger.warn(
      {
        event: 'telegram_message_delete_failed',
        channel: 'telegram',
        phone: input.chatId,
        messageId: String(input.messageId),
        message: typedError.message,
      },
      'Failed to delete duplicate Telegram message',
    );

    throw typedError instanceof MessagingError
      ? typedError
      : new MessagingError(`Telegram deleteMessage failed: ${typedError.message}`);
  }
}
