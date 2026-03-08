import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import twilio from 'twilio';

import type { Channel, InboundMessage } from '../models/types';
import { processMessage } from '../services/agent';
import { sendMessage } from '../services/messaging';

type TwilioWebhookBody = {
  MessageSid?: string;
  From?: string;
  To?: string;
  Body?: string;
  NumMedia?: string;
  [key: string]: string | undefined;
};

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
  if (process.env.SKIP_TWILIO_VALIDATION === 'true') {
    return true;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
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

async function handleInbound(
  request: FastifyRequest<{ Body: TwilioWebhookBody }>,
  reply: FastifyReply,
  channel: Channel,
): Promise<void> {
  if (!validateTwilioSignature(request)) {
    reply.code(403).send({ error: 'Invalid Twilio signature' });
    return;
  }

  const message = parseInboundMessage(request.body ?? {}, channel);
  console.log('Inbound message', message);

  const responseText = await processMessage(message);
  await sendMessage({
    to: message.from,
    body: responseText,
    channel: message.channel,
  });

  emptyTwimlResponse(reply);
}

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: TwilioWebhookBody }>('/api/webhook/sms', async (request, reply) => {
    await handleInbound(request, reply, 'sms');
  });

  fastify.post<{ Body: TwilioWebhookBody }>('/api/webhook/whatsapp', async (request, reply) => {
    await handleInbound(request, reply, 'whatsapp');
  });
};

export default webhookRoutes;
