import twilio from 'twilio';

import config from '../config';
import { MessagingError } from '../lib/errors';
import logger from '../lib/logger';
import type { Channel } from '../models/types';

export interface OutboundMessage {
  to: string;
  body: string;
  channel: Channel;
  mediaUrl?: string;
}

type TwilioChannel = Extract<Channel, 'sms' | 'whatsapp'>;
type MessageAdapter = (message: OutboundMessage) => Promise<string>;

function normalizePhoneNumber(phone: string): string {
  return phone.replace(/^whatsapp:/, '').trim();
}

function twilioChannelPhoneNumber(phone: string, channel: TwilioChannel): string {
  const normalized = normalizePhoneNumber(phone);
  return channel === 'whatsapp' ? `whatsapp:${normalized}` : normalized;
}

function getTwilioClient() {
  const accountSid = config.TWILIO_ACCOUNT_SID;
  const authToken = config.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new MessagingError('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set.');
  }

  return twilio(accountSid, authToken);
}

function getTwilioFromNumber(channel: TwilioChannel): string {
  const smsNumber = config.TWILIO_SMS_NUMBER;
  const whatsappNumber = config.TWILIO_WHATSAPP_NUMBER;

  if (channel === 'whatsapp') {
    if (!whatsappNumber) {
      throw new MessagingError('TWILIO_WHATSAPP_NUMBER must be set for WhatsApp messaging.');
    }

    return twilioChannelPhoneNumber(whatsappNumber, channel);
  }

  if (!smsNumber) {
    throw new MessagingError('TWILIO_SMS_NUMBER must be set for SMS messaging.');
  }

  return twilioChannelPhoneNumber(smsNumber, channel);
}

async function twilioAdapter(message: OutboundMessage): Promise<string> {
  const channel = message.channel as TwilioChannel;

  if (config.SKIP_TWILIO_SEND) {
    const mockSid = `MOCK_${Date.now()}`;
    logger.info(
      {
        event: 'message_sent',
        id: mockSid,
        recipient: message.to,
        channel: message.channel,
        bodyLength: message.body.length,
        hasMedia: Boolean(message.mediaUrl),
        skipped: true,
      },
      'Outbound message send skipped',
    );
    return mockSid;
  }

  const client = getTwilioClient();

  const response = await client.messages.create({
    to: twilioChannelPhoneNumber(message.to, channel),
    from: getTwilioFromNumber(channel),
    body: message.body,
    mediaUrl: message.mediaUrl ? [message.mediaUrl] : undefined,
  });

  logger.info(
    {
      event: 'message_sent',
      id: response.sid,
      recipient: message.to,
      channel: message.channel,
      bodyLength: message.body.length,
      hasMedia: Boolean(message.mediaUrl),
    },
    'Outbound message sent',
  );

  return response.sid;
}

async function googleChatAdapter(message: OutboundMessage): Promise<string> {
  logger.warn(
    {
      event: 'message_adapter_not_implemented',
      recipient: message.to,
      channel: message.channel,
    },
    'Google Chat adapter not implemented',
  );

  throw new MessagingError('google_chat adapter is not implemented yet.');
}

const channelAdapters: Record<Channel, MessageAdapter> = {
  sms: twilioAdapter,
  whatsapp: twilioAdapter,
  google_chat: googleChatAdapter,
};

export async function sendMessage(message: OutboundMessage): Promise<string> {
  try {
    logger.info(
      {
        event: 'message_send_requested',
        recipient: message.to,
        channel: message.channel,
        bodyLength: message.body.length,
      },
      'Outbound message requested',
    );

    const adapter = channelAdapters[message.channel];
    return await adapter(message);
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));

    logger.error(
      {
        event: 'error',
        type: 'MessagingError',
        recipient: message.to,
        channel: message.channel,
        message: typedError.message,
        stack: typedError.stack,
      },
      'Failed to send outbound message',
    );

    throw typedError instanceof MessagingError
      ? typedError
      : new MessagingError(`Message send failed: ${typedError.message}`);
  }
}
