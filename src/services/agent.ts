import type { InboundMessage } from '../models/types';

export async function processMessage(message: InboundMessage): Promise<string> {
  return `Got your message: ${message.body}`;
}
