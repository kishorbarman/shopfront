import twilio from 'twilio';

import type { Channel } from '../models/types';

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
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set.');
  }

  return twilio(accountSid, authToken);
}

function getFromNumber(channel: Channel): string {
  const smsNumber = process.env.TWILIO_SMS_NUMBER;
  const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (channel === 'whatsapp') {
    if (!whatsappNumber) {
      throw new Error('TWILIO_WHATSAPP_NUMBER must be set for WhatsApp messaging.');
    }
    return channelPhoneNumber(whatsappNumber, channel);
  }

  if (!smsNumber) {
    throw new Error('TWILIO_SMS_NUMBER must be set for SMS messaging.');
  }

  return channelPhoneNumber(smsNumber, channel);
}

export async function sendMessage(message: OutboundMessage): Promise<string> {
  if (process.env.SKIP_TWILIO_SEND === 'true') {
    const mockSid = `MOCK_${Date.now()}`;
    console.log('Outbound message (skipped Twilio send)', {
      id: mockSid,
      to: message.to,
      channel: message.channel,
      hasMedia: Boolean(message.mediaUrl),
    });
    return mockSid;
  }

  const client = getTwilioClient();

  const response = await client.messages.create({
    to: channelPhoneNumber(message.to, message.channel),
    from: getFromNumber(message.channel),
    body: message.body,
    mediaUrl: message.mediaUrl ? [message.mediaUrl] : undefined,
  });

  console.log('Outbound message', {
    id: response.sid,
    to: message.to,
    channel: message.channel,
    hasMedia: Boolean(message.mediaUrl),
  });

  return response.sid;
}
