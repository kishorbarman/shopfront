export interface OutboundMessage {
  to: string;
  body: string;
  channel: 'sms' | 'whatsapp';
  mediaUrl?: string;
}

export async function sendMessage(message: OutboundMessage): Promise<string> {
  // Placeholder implementation for Step 1 scaffolding.
  void message;
  return Promise.resolve('not-implemented');
}
