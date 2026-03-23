import type { FailedMessage } from '@prisma/client';

import { prisma } from '../lib/prisma';
import type { InboundMessage } from '../models/types';
import type { OutboundMessage } from './messaging';

export type FailedPayload =
  | InboundMessage
  | {
      __failedStage: 'outbound';
      inbound: InboundMessage;
      outbound: OutboundMessage;
      responseText?: string;
    };

export async function enqueueFailedMessage(
  message: InboundMessage,
  error: unknown,
  retries = 3,
): Promise<FailedMessage> {
  const typedError = error instanceof Error ? error : new Error(String(error));

  return prisma.failedMessage.create({
    data: {
      twilioSid: message.id || null,
      phone: message.from,
      channel: message.channel,
      payload: message as unknown as object,
      errorType: typedError.name || 'Error',
      errorMessage: typedError.message,
      errorStack: typedError.stack ?? null,
      retries,
    },
  });
}

export async function enqueueFailedOutboundMessage(
  inbound: InboundMessage,
  outbound: OutboundMessage,
  error: unknown,
  retries = 3,
): Promise<FailedMessage> {
  const typedError = error instanceof Error ? error : new Error(String(error));
  const payload: FailedPayload = {
    __failedStage: 'outbound',
    inbound,
    outbound,
    responseText: outbound.body,
  };

  return prisma.failedMessage.create({
    data: {
      twilioSid: inbound.id || null,
      phone: inbound.from,
      channel: inbound.channel,
      payload: payload as unknown as object,
      errorType: typedError.name || 'Error',
      errorMessage: typedError.message,
      errorStack: typedError.stack ?? null,
      retries,
    },
  });
}

export async function listPendingFailedMessages(limit = 50): Promise<FailedMessage[]> {
  return prisma.failedMessage.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

export async function markFailedMessageProcessed(id: string): Promise<void> {
  await prisma.failedMessage.update({
    where: { id },
    data: { processedAt: new Date() },
  });
}

export async function updateFailedMessageError(id: string, error: unknown): Promise<void> {
  const typedError = error instanceof Error ? error : new Error(String(error));

  await prisma.failedMessage.update({
    where: { id },
    data: {
      errorType: typedError.name || 'Error',
      errorMessage: typedError.message,
      errorStack: typedError.stack ?? null,
    },
  });
}
