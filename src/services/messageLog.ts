import type { MessageProcessStatus } from '@prisma/client';

import logger from '../lib/logger';
import { prisma } from '../lib/prisma';

type MessageLogInput = {
  twilioSid?: string;
  shopId?: string | null;
  phone: string;
  channel: string;
  inboundText: string;
  parsedIntent?: string;
  parsedSummary?: string;
  updateApplied?: boolean;
  status: MessageProcessStatus;
  errorMessage?: string;
  responseText?: string;
};

function nonEmpty(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function writeMessageLog(input: MessageLogInput): Promise<void> {
  const payload = {
    shopId: input.shopId ?? null,
    phone: input.phone,
    channel: input.channel,
    inboundText: input.inboundText,
    parsedIntent: nonEmpty(input.parsedIntent) ?? null,
    parsedSummary: nonEmpty(input.parsedSummary) ?? null,
    updateApplied: input.updateApplied ?? false,
    status: input.status,
    errorMessage: nonEmpty(input.errorMessage) ?? null,
    responseText: nonEmpty(input.responseText) ?? null,
  };

  try {
    const twilioSid = nonEmpty(input.twilioSid);

    if (twilioSid) {
      await prisma.messageLog.upsert({
        where: { twilioSid },
        create: {
          ...payload,
          twilioSid,
        },
        update: payload,
      });
      return;
    }

    await prisma.messageLog.create({
      data: payload,
    });
  } catch (error) {
    const typedError = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        event: 'error',
        type: typedError.name,
        message: typedError.message,
        stack: typedError.stack,
        phone: input.phone,
      },
      'Failed to persist message log',
    );
  }
}
