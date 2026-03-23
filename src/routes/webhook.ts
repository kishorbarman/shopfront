import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';

import type { Channel, InboundMessage } from '../models/types';
import config from '../config';
import {
  AgentParseError,
  AgentConfidenceError,
  DatabaseError,
  MessagingError,
  RateLimitError,
  SpamGuardError,
  ValidationError,
} from '../lib/errors';
import logger from '../lib/logger';
import { reportError, triggerOperationalAlert } from '../lib/observability';
import { redis } from '../lib/redis';
import {
  parseTelegramUpdate,
  telegramIdempotencyKey,
  type TelegramUpdate,
  validateTelegramWebhookSignature,
} from '../lib/telegramAuth';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/agent';
import { getState, setState, type ConversationState } from '../services/conversationState';
import { writeMessageLog } from '../services/messageLog';
import { summarizeMessageAction } from '../services/messageSummary';
import { enqueueFailedMessage, enqueueFailedOutboundMessage } from '../services/failedMessageQueue';
import { sendMessage } from '../services/messaging';
import { rebuildSite } from '../services/siteBuilder';
import { findIdentityByExternalUserId, upsertChannelIdentity } from '../services/channelIdentity';
import { consumeTelegramLinkCode, parseTelegramLinkCommand } from '../services/telegramLinking';
import { incrementCounter } from '../lib/opsMetrics';

type TwilioWebhookBody = {
  MessageSid?: string;
  From?: string;
  To?: string;
  Body?: string;
  NumMedia?: string;
  [key: string]: string | undefined;
};

const PROCESS_RETRY_LIMIT = 3;

function normalizePhoneNumber(phone: string): string {
  return phone.replace(/^whatsapp:/, '').trim();
}

function parseMediaUrls(body: TwilioWebhookBody): string[] {
  const mediaCount = Number.parseInt(body.NumMedia ?? '0', 10);
  if (!Number.isFinite(mediaCount) || mediaCount <= 0) {
    return [];
  }

  const mediaUrls: string[] = [];
  for (let i = 0; i < mediaCount; i += 1) {
    const mediaUrl = body[`MediaUrl${i}`];
    if (mediaUrl) {
      mediaUrls.push(mediaUrl);
    }
  }

  return mediaUrls;
}

function getRequestUrl(request: FastifyRequest): string {
  const protocol = request.protocol;
  const host = request.headers.host;
  return `${protocol}://${host}${request.raw.url ?? ''}`;
}

function normalizeValidationParams(body: TwilioWebhookBody): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return normalized;
}

function validateTwilioSignature(request: FastifyRequest<{ Body: TwilioWebhookBody }>): boolean {
  if (config.SKIP_TWILIO_VALIDATION) {
    return true;
  }

  const authToken = config.TWILIO_AUTH_TOKEN;
  const signature = request.headers['x-twilio-signature'];

  if (!authToken || typeof signature !== 'string') {
    return false;
  }

  return twilio.validateRequest(
    authToken,
    signature,
    getRequestUrl(request),
    normalizeValidationParams(request.body ?? {}),
  );
}

function parseInboundMessage(body: TwilioWebhookBody, channel: Channel): InboundMessage {
  return {
    id: body.MessageSid ?? '',
    from: normalizePhoneNumber(body.From ?? ''),
    to: normalizePhoneNumber(body.To ?? ''),
    body: body.Body ?? '',
    mediaUrls: parseMediaUrls(body),
    channel,
    timestamp: new Date(),
  };
}

function emptyTwimlResponse(reply: FastifyReply): void {
  const response = new twilio.twiml.MessagingResponse();
  reply.code(200).type('text/xml').send(response.toString());
}

function telegramOkResponse(reply: FastifyReply, payload: Record<string, unknown> = { ok: true }): void {
  reply.code(200).send(payload);
}

async function sendTelegramReply(to: string, body: string): Promise<void> {
  await sendMessage({
    to,
    body,
    channel: 'telegram',
  });
}

async function handleTelegramCommand(
  message: InboundMessage,
  linkedShopId: string | null,
): Promise<string | null> {
  const command = parseTelegramLinkCommand(message.body);
  if (!command) {
    return null;
  }

  if (command.command === 'start') {
    if (linkedShopId) {
      const shop = await prisma.shop.findUnique({
        where: { id: linkedShopId },
        select: { name: true },
      });

      if (shop) {
        return "Welcome back! You're linked to " + shop.name + '. Text any update now, or use /help.';
      }
    }

    return 'Welcome to Shopfront on Telegram! Tell me your business name to create your page, or send /link YOURCODE to connect an existing shop.';
  }

  if (command.command === 'help') {
    return 'I can update your services, hours, notices, address, and photos. Useful commands: /status, /site, /support. If your shop exists by phone, text "link telegram" there to get a code, then send /link YOURCODE here.';
  }

  if (command.command === 'status') {
    if (!linkedShopId) {
      return 'Status: not linked yet. Send /link YOURCODE or start onboarding by telling me your business name.';
    }

    const state = await getState(message.from);
    const shop = await prisma.shop.findUnique({
      where: { id: linkedShopId },
      select: { name: true, status: true },
    });

    const pendingIntent = state?.pendingAction?.intent ? ', pending=' + state.pendingAction.intent : '';
    return (
      'Status: linked to ' +
      (shop?.name ?? 'your shop') +
      ' (' +
      (shop?.status ?? 'ACTIVE') +
      '), mode=' +
      (state?.mode ?? 'active') +
      pendingIntent +
      '.'
    );
  }

  if (command.command === 'site') {
    if (!linkedShopId) {
      return 'No linked site yet. Send /link YOURCODE or complete onboarding first.';
    }

    const shop = await prisma.shop.findUnique({
      where: { id: linkedShopId },
      select: { slug: true },
    });

    if (!shop?.slug) {
      return 'I could not find your site URL yet. Try again in a moment.';
    }

    return 'Your live site: ' + config.BASE_URL.replace(/\/$/, '') + '/s/' + shop.slug;
  }

  if (command.command === 'support') {
    logger.info(
      {
        event: 'support_requested',
        channel: 'telegram',
        phone: message.from,
        linkedShopId: linkedShopId ?? null,
      },
      'Support command requested',
    );

    return 'Support: I will troubleshoot first. If I am not confident, I escalate to a human specialist. You can also email contact@shopfront.page.';
  }

  if (command.command === 'link') {
    if (linkedShopId) {
      return 'This Telegram account is already linked. You can start sending updates directly.';
    }

    if (!command.code) {
      return 'Please send /link YOURCODE. You can get the code by texting "link telegram" from your linked phone number.';
    }

    const shopId = await consumeTelegramLinkCode(command.code);
    if (!shopId) {
      return 'That link code is invalid or expired. Text "link telegram" from your phone number to generate a new code.';
    }

    await upsertChannelIdentity(shopId, {
      channel: 'telegram',
      externalUserId: message.externalUserId,
      externalSpaceId: message.externalSpaceId,
      phone: message.from,
    });

    await setState(message.from, {
      mode: 'active',
      shopId,
      lastMessageAt: new Date().toISOString(),
    });

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { slug: true },
    });

    const baseUrl = config.BASE_URL.replace(/\/$/, '');
    return "Linked successfully. You're all set. Your page is " + baseUrl + '/s/' + (shop?.slug ?? 'your-shop') + '.';
  }

  return null;
}

function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|correct|looks good|right|ok|okay|do it|sure)\b/i.test(text.trim());
}

function pickIntent(beforeState: ConversationState | null, afterState: ConversationState | null): string | undefined {
  return afterState?.pendingAction?.intent ?? beforeState?.pendingAction?.intent ?? undefined;
}

function inferIntentFromMessage(message: InboundMessage, responseText: string): string | undefined {
  const body = message.body.toLowerCase();
  const response = responseText.toLowerCase();

  if (/\bhelp\b/.test(body)) return 'help';
  if (/^(hi|hello|hey|yo)\b/.test(body.trim())) return 'greeting';

  if (/(banner|photo|image|gallery|profile)/.test(body)) return 'update_photo';
  if (/(what|show)\b/.test(body) || response.includes('currently') || response.includes('your current hours')) return 'query';

  if (/\b(remove|delete)\b/.test(body) && /notice/.test(body)) return 'remove_notice';
  if (/\b(notice|announce|announcement|sign)\b/.test(body)) return 'add_notice';

  if (/\b(remove|delete)\b/.test(body) && /(service|menu|haircut|fade|trim|shave)/.test(body)) return 'remove_service';
  if (/\badd\b/.test(body) && /(service|menu|\$\d|price|lineup|haircut|fade|trim|shave)/.test(body)) return 'add_service';

  if (/(hour|open|close|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(body)) return 'update_hours';
  if (/(address|phone|number|contact)/.test(body)) return 'update_contact';

  if (/\b(change|update|set)\b/.test(body) && /(service|menu|price|\$\d|haircut|fade|trim|shave)/.test(body)) {
    return 'update_service';
  }

  if (response.startsWith('updated!')) return 'update_service';
  if (response.startsWith('done!') && response.includes('added')) return 'add_service';
  if (response.startsWith('removed!')) return 'remove_service';
  if (response.startsWith('got it!') && response.includes('closure')) return 'temp_closure';

  return undefined;
}

function didApplyMutation(
  messageBody: string,
  beforeState: ConversationState | null,
  afterState: ConversationState | null,
): boolean {
  const wasAwaiting = beforeState?.mode === 'awaiting_confirmation' && Boolean(beforeState.pendingAction);
  if (!wasAwaiting || !isAffirmative(messageBody)) {
    return false;
  }

  return afterState?.mode === 'active' && !afterState.pendingAction;
}

function responseImpliesMutation(responseText: string): boolean {
  const normalized = responseText.trim().toLowerCase();
  return (
    normalized.startsWith('done!') ||
    normalized.startsWith('updated!') ||
    normalized.startsWith('removed!') ||
    normalized.startsWith('got it!')
  );
}

function fallbackForError(error: unknown): string {
  if (error instanceof RateLimitError || error instanceof SpamGuardError) {
    return "You're sending a lot of messages! Give me a minute to catch up.";
  }

  if (error instanceof AgentParseError || error instanceof AgentConfidenceError || error instanceof ValidationError) {
    return "I didn't quite catch that. Are you trying to update your services, hours, or something else?";
  }

  if (error instanceof DatabaseError) {
    return "Something went wrong on my end. Your change didn't go through - try again in a minute?";
  }

  if (error instanceof MessagingError) {
    return "Sorry, I'm having a moment. Try sending that again?";
  }

  return "Something unexpected happened. Text me again and I'll try my best.";
}

async function processWithRetries(message: InboundMessage): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PROCESS_RETRY_LIMIT; attempt += 1) {
    try {
      return await processMessage(message);
    } catch (error) {
      lastError = error;
      const typedError = error instanceof Error ? error : new Error(String(error));
      logger.error(
        {
          event: 'error',
          type: typedError.name,
          phone: message.from,
          messageId: message.id,
          attempt,
          message: typedError.message,
          stack: typedError.stack,
        },
        'Message processing attempt failed',
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function handleInbound(
  request: FastifyRequest<{ Body: TwilioWebhookBody }>,
  reply: FastifyReply,
  channel: Channel,
): Promise<void> {
  if (!validateTwilioSignature(request)) {
    logger.warn(
      {
        event: 'error',
        type: 'TwilioSignatureValidationError',
        channel,
        path: request.url,
      },
      'Twilio signature validation failed',
    );
    incrementCounter('webhookAuthFailures');
    triggerOperationalAlert('webhook_auth_failed', 'Twilio signature validation failed', {
      channel,
      path: request.url,
    });
    reply.code(403).send({ error: 'Invalid Twilio signature' });
    return;
  }

  const message = parseInboundMessage(request.body ?? {}, channel);

  logger.info(
    {
      event: 'message_received',
      phone: message.from,
      channel: message.channel,
      bodyLength: message.body.length,
      hasMedia: message.mediaUrls.length > 0,
    },
    'Inbound message received',
  );

  const beforeState = await getState(message.from);

  let responseText: string;
  let processingError: Error | null = null;

  try {
    responseText = await processWithRetries(message);
  } catch (error) {
    processingError = error instanceof Error ? error : new Error(String(error));
    responseText = fallbackForError(error);

    await enqueueFailedMessage(message, error, PROCESS_RETRY_LIMIT);

    reportError(processingError, {
      tags: {
        channel: message.channel,
        shopId: 'unknown',
        intent: 'unknown',
      },
      extra: {
        phone: message.from,
        twilioSid: message.id,
      },
    });

    logger.error(
      {
        event: 'error',
        type: processingError.name,
        phone: message.from,
        messageId: message.id,
        message: processingError.message,
        stack: processingError.stack,
      },
      'Message processing failed after retries; saved to dead letter queue',
    );
  }

  const afterState = await getState(message.from);


  const parsedIntent = pickIntent(beforeState, afterState) ?? inferIntentFromMessage(message, responseText);
  const status = processingError ? 'FAILED' : 'PROCESSED';
  const updateApplied =
    status === 'PROCESSED' &&
    (didApplyMutation(message.body, beforeState, afterState) || responseImpliesMutation(responseText));
  const parsedSummary =
    summarizeMessageAction({
      messageBody: message.body,
      beforeState,
      afterState,
      updateApplied,
      status,
    }) ?? (updateApplied ? 'applied_change: ' + responseText : undefined);

  await writeMessageLog({
    twilioSid: message.id,
    shopId: afterState?.shopId ?? beforeState?.shopId ?? null,
    phone: message.from,
    channel: message.channel,
    inboundText: message.body || '(empty)',
    parsedIntent,
    parsedSummary,
    updateApplied,
    status,
    errorMessage: processingError?.message,
    responseText,
  });

  const logShopId = afterState?.shopId ?? beforeState?.shopId ?? null;

  if (logShopId) {
    try {
      await rebuildSite(logShopId);
    } catch (error) {
      const typedError = error instanceof Error ? error : new Error(String(error));
      logger.error(
        {
          event: 'error',
          type: typedError.name,
          message: typedError.message,
          stack: typedError.stack,
          shopId: logShopId,
          phone: message.from,
        },
        'Failed to rebuild site after message logging',
      );
    }
  }

  const outboundReply = {
    to: message.from,
    body: responseText,
    channel: message.channel,
  } as const;

  try {
    await sendMessage(outboundReply);
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));
    incrementCounter('outboundDeliveryFailures');
    triggerOperationalAlert('outbound_delivery_failed', 'Failed to deliver outbound channel reply', {
      channel: message.channel,
      phone: message.from,
      messageId: message.id,
    });

    await enqueueFailedOutboundMessage(message, outboundReply, typedError, PROCESS_RETRY_LIMIT);

    reportError(typedError, {
      tags: {
        channel: message.channel,
      },
      extra: {
        phone: message.from,
        twilioSid: message.id,
      },
    });

    logger.error(
      {
        event: 'error',
        type: typedError.name,
        phone: message.from,
        messageId: message.id,
        message: typedError.message,
        stack: typedError.stack,
      },
      'Failed to send reply message',
    );
  }

  emptyTwimlResponse(reply);
}

async function handleTelegramInbound(
  request: FastifyRequest<{ Body: TelegramUpdate }>,
  reply: FastifyReply,
): Promise<void> {
  if (!config.ENABLE_TELEGRAM) {
    reply.code(404).send({ error: 'Telegram integration is disabled' });
    return;
  }

  // TODO: Keep SKIP_TELEGRAM_VALIDATION=false in production environments.
  if (
    !validateTelegramWebhookSignature(
      request.headers,
      config.TELEGRAM_WEBHOOK_SECRET,
      config.SKIP_TELEGRAM_VALIDATION,
    )
  ) {
    logger.warn(
      {
        event: 'error',
        type: 'TelegramSignatureValidationError',
        path: request.url,
      },
      'Telegram request validation failed',
    );
    incrementCounter('webhookAuthFailures');
    triggerOperationalAlert('webhook_auth_failed', 'Telegram webhook signature validation failed', {
      path: request.url,
    });
    reply.code(403).send({ error: 'Invalid Telegram webhook signature' });
    return;
  }

  const parsedUpdate = parseTelegramUpdate(request.body ?? {});
  if (!parsedUpdate) {
    logger.info(
      {
        event: 'telegram_update_ignored',
      },
      'Ignored unsupported Telegram update payload',
    );
    telegramOkResponse(reply, { ok: true, ignored: true });
    return;
  }

  const idempotencyKey = telegramIdempotencyKey(parsedUpdate.updateId);
  const marked = await redis.set(idempotencyKey, '1', 'EX', 60 * 60 * 24, 'NX');
  if (marked !== 'OK') {
    logger.info(
      {
        event: 'telegram_duplicate_update',
        updateId: parsedUpdate.updateId,
      },
      'Duplicate Telegram update ignored',
    );
    telegramOkResponse(reply, { ok: true, duplicate: true });
    return;
  }

  const message: InboundMessage = {
    id: `TG_${parsedUpdate.messageId}`,
    from: `telegram:${parsedUpdate.externalUserId}`,
    to: config.TELEGRAM_BOT_USERNAME || 'telegram-bot',
    body: parsedUpdate.body,
    mediaUrls: [],
    channel: 'telegram',
    timestamp: parsedUpdate.timestamp,
    externalUserId: parsedUpdate.externalUserId,
    externalSpaceId: parsedUpdate.externalSpaceId,
    rawPayload: request.body,
  };

  const parsedCommand = parseTelegramLinkCommand(message.body);
  if (parsedCommand?.command === 'start') {
    const startKey = 'telegram:start:' + message.externalUserId;
    const firstStart = await redis.set(startKey, message.id, 'EX', 10, 'NX');
    if (firstStart !== 'OK') {
      logger.info(
        {
          event: 'telegram_duplicate_start_suppressed',
          updateId: parsedUpdate.updateId,
          externalUserId: message.externalUserId,
        },
        'Duplicate /start command suppressed',
      );
      telegramOkResponse(reply, { ok: true, duplicate: true });
      return;
    }
  }

  logger.info(
    {
      event: 'message_received',
      phone: message.from,
      channel: message.channel,
      bodyLength: message.body.length,
      hasMedia: message.mediaUrls.length > 0,
      externalUserId: message.externalUserId,
      externalSpaceId: message.externalSpaceId,
    },
    'Inbound message received',
  );

  const linkedIdentity = message.externalUserId
    ? await findIdentityByExternalUserId('telegram', message.externalUserId)
    : null;

  const commandResponse = await handleTelegramCommand(message, linkedIdentity?.shopId ?? null);
  if (commandResponse) {
    const commandOutboundReply = {
      to: message.externalSpaceId ?? message.externalUserId ?? message.from,
      body: commandResponse,
      channel: 'telegram' as const,
    };

    try {
      await sendTelegramReply(commandOutboundReply.to, commandResponse);
    } catch (error) {
      const typedError = error instanceof Error ? error : new Error(String(error));
      incrementCounter('outboundDeliveryFailures');
      triggerOperationalAlert('outbound_delivery_failed', 'Failed to deliver Telegram command reply', {
        channel: message.channel,
        phone: message.from,
        messageId: message.id,
        telegramUpdateId: parsedUpdate.updateId,
      });

      await enqueueFailedOutboundMessage(message, commandOutboundReply, typedError, PROCESS_RETRY_LIMIT);
      reportError(typedError, {
        tags: {
          channel: message.channel,
        },
        extra: {
          phone: message.from,
          telegramUpdateId: parsedUpdate.updateId,
        },
      });
    }

    telegramOkResponse(reply);
    return;
  }

  const beforeState = await getState(message.from);

  let responseText: string;
  let processingError: Error | null = null;

  try {
    responseText = await processWithRetries(message);
  } catch (error) {
    processingError = error instanceof Error ? error : new Error(String(error));
    responseText = fallbackForError(error);

    await enqueueFailedMessage(message, error, PROCESS_RETRY_LIMIT);

    reportError(processingError, {
      tags: {
        channel: message.channel,
        shopId: 'unknown',
        intent: 'unknown',
      },
      extra: {
        phone: message.from,
        telegramUpdateId: parsedUpdate.updateId,
      },
    });

    logger.error(
      {
        event: 'error',
        type: processingError.name,
        phone: message.from,
        messageId: message.id,
        message: processingError.message,
        stack: processingError.stack,
      },
      'Telegram message processing failed after retries; saved to dead letter queue',
    );
  }

  const afterState = await getState(message.from);

  if (message.externalUserId && afterState?.shopId) {
    await upsertChannelIdentity(afterState.shopId, {
      channel: 'telegram',
      externalUserId: message.externalUserId,
      externalSpaceId: message.externalSpaceId,
      phone: message.from,
    });
  }

  const parsedIntent = pickIntent(beforeState, afterState) ?? inferIntentFromMessage(message, responseText);
  const status = processingError ? 'FAILED' : 'PROCESSED';
  const updateApplied =
    status === 'PROCESSED' &&
    (didApplyMutation(message.body, beforeState, afterState) || responseImpliesMutation(responseText));
  const parsedSummary =
    summarizeMessageAction({
      messageBody: message.body,
      beforeState,
      afterState,
      updateApplied,
      status,
    }) ?? (updateApplied ? 'applied_change: ' + responseText : undefined);

  await writeMessageLog({
    twilioSid: message.id,
    shopId: afterState?.shopId ?? beforeState?.shopId ?? null,
    phone: message.from,
    channel: message.channel,
    inboundText: message.body || '(empty)',
    parsedIntent,
    parsedSummary,
    updateApplied,
    status,
    errorMessage: processingError?.message,
    responseText,
  });

  logger.info(
    {
      event: 'telegram_response_ready',
      externalUserId: message.externalUserId,
      externalSpaceId: message.externalSpaceId,
      bodyLength: responseText.length,
      hasError: Boolean(processingError),
    },
    'Telegram response generated',
  );

  const telegramOutboundReply = {
    to: message.externalSpaceId ?? message.externalUserId ?? message.from,
    body: responseText,
    channel: 'telegram' as const,
  };

  try {
    await sendMessage(telegramOutboundReply);
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));
    incrementCounter('outboundDeliveryFailures');
    triggerOperationalAlert('outbound_delivery_failed', 'Failed to deliver Telegram reply', {
      channel: message.channel,
      phone: message.from,
      messageId: message.id,
      telegramUpdateId: parsedUpdate.updateId,
    });

    await enqueueFailedOutboundMessage(message, telegramOutboundReply, typedError, PROCESS_RETRY_LIMIT);

    reportError(typedError, {
      tags: {
        channel: message.channel,
      },
      extra: {
        phone: message.from,
        telegramUpdateId: parsedUpdate.updateId,
      },
    });

    logger.error(
      {
        event: 'error',
        type: typedError.name,
        phone: message.from,
        messageId: message.id,
        message: typedError.message,
        stack: typedError.stack,
      },
      'Failed to send Telegram reply message',
    );
  }

  telegramOkResponse(reply);
}

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: TwilioWebhookBody }>('/api/webhook/sms', async (request, reply) => {
    await handleInbound(request, reply, 'sms');
  });

  fastify.post<{ Body: TwilioWebhookBody }>('/api/webhook/whatsapp', async (request, reply) => {
    await handleInbound(request, reply, 'whatsapp');
  });

  fastify.post<{ Body: TelegramUpdate }>('/api/webhook/telegram', async (request, reply) => {
    await handleTelegramInbound(request, reply);
  });
};

export default webhookRoutes;
