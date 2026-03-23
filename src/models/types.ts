export type Channel = 'sms' | 'whatsapp' | 'telegram';

export interface InboundMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  mediaUrls: string[];
  channel: Channel;
  timestamp: Date;
  externalUserId?: string;
  externalSpaceId?: string;
  rawPayload?: unknown;
}
