export type Channel = 'sms' | 'whatsapp';

export interface InboundMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  mediaUrls: string[];
  channel: Channel;
  timestamp: Date;
}
