import twilio from 'twilio';

import type { Channel } from '../models/types';
import config from '../config';
import { MessagingError } from '../lib/errors';
import logger from '../lib/logger';

export interface OutboundMessage {
  to: string;
  body: string;
  channel: Channel;
  mediaUrl?: string;
}

function normalizePhoneNumber(phone: string): string {
  return phone.replace(/^whatsapp:/, '').trim();
}

function channelPhoneNumber(phone: string, channel: Channel): string {
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

function getFromNumber(channel: Channel): string {
  const smsNumber = config.TWILIO_SMS_NUMBER;
  const whatsappNumber = config.TWILIO_WHATSAPP_NUMBER;

  if (channel === 'whatsapp') {
    if (!whatsappNumber) {
      throw new MessagingError('TWILIO_WHATSAPP_NUMBER must be set for WhatsApp messaging.');
    }
    return channelPhoneNumber(whatsappNumber, channel);
  }

  if (!smsNumber) {
    throw new MessagingError('TWILIO_SMS_NUMBER must be set for SMS messaging.');
  }

  return channelPhoneNumber(smsNumber, channel);
}

export async function sendMessage(message: OutboundMessage): Promise<string> {
  try {
    if (config.SKIP_TWILIO_SEND) {
      const mockSid = `MOCK_${Date.now()}`;
      logger.info(
        {
          event: 'message_sent',
          id: mockSid,
          phone: message.to,
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
      to: channelPhoneNumber(message.to, message.channel),
      from: getFromNumber(message.channel),
      body: message.body,
      mediaUrl: message.mediaUrl ? [message.mediaUrl] : undefined,
    });

    logger.info(
      {
        event: 'message_sent',
        id: response.sid,
        phone: message.to,
        channel: message.channel,
        bodyLength: message.body.length,
        hasMedia: Boolean(message.mediaUrl),
      },
      'Outbound message sent',
    );

    return response.sid;
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        event: 'error',
        type: 'MessagingError',
        message: typedError.message,
        stack: typedError.stack,
      },
      'Failed to send outbound message',
    );

    throw typedError instanceof MessagingError
      ? typedError
      : new MessagingError(`Twilio send failed: ${typedError.message}`);
  }
}
