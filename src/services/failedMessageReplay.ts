import type { FailedMessage } from '@prisma/client';

import logger from '../lib/logger';
import type { InboundMessage } from '../models/types';
import {
  listPendingFailedMessages,
  markFailedMessageProcessed,
  updateFailedMessageError,
  type FailedPayload,
} from './failedMessageQueue';
import { sendMessage } from './messaging';
import { processMessage } from './agent';

function isOutboundReplayPayload(payload: FailedPayload): payload is {
  __failedStage: 'outbound';
  inbound: InboundMessage;
  outbound: Parameters<typeof sendMessage>[0];
  responseText?: string;
} {
  return typeof payload === 'object' && payload !== null && '__failedStage' in payload;
}

function outboundTargetFromInbound(message: InboundMessage): string {
  if (message.channel === 'telegram') {
    return message.externalSpaceId ?? message.externalUserId ?? message.from;
  }

  return message.from;
}

async function replayOne(failed: FailedMessage): Promise<void> {
  const payload = failed.payload as unknown as FailedPayload;

  if (isOutboundReplayPayload(payload)) {
    await sendMessage(payload.outbound);
    await markFailedMessageProcessed(failed.id);

    logger.info(
      {
        event: 'failed_message_replayed',
        id: failed.id,
        phone: failed.phone,
        channel: failed.channel,
        stage: 'outbound',
      },
      'Failed outbound message replayed successfully',
    );
    return;
  }

  const inbound = payload as InboundMessage;
  const response = await processMessage(inbound);

  await sendMessage({
    to: outboundTargetFromInbound(inbound),
    body: response,
    channel: inbound.channel,
  });

  await markFailedMessageProcessed(failed.id);

  logger.info(
    {
      event: 'failed_message_replayed',
      id: failed.id,
      phone: failed.phone,
      channel: failed.channel,
      stage: 'full',
    },
    'Failed message replayed successfully',
  );
}

export async function replayFailedMessages(limit = 100): Promise<void> {
  const failedMessages = await listPendingFailedMessages(limit);

  if (failedMessages.length === 0) {
    logger.info({ event: 'failed_message_replay', count: 0 }, 'No failed messages to replay');
    return;
  }

  logger.info(
    {
      event: 'failed_message_replay',
      count: failedMessages.length,
    },
    'Replaying failed messages',
  );

  for (const failed of failedMessages) {
    try {
      await replayOne(failed);
    } catch (error) {
      await updateFailedMessageError(failed.id, error);
      const typedError = error instanceof Error ? error : new Error(String(error));

      logger.error(
        {
          event: 'error',
          type: typedError.name,
          id: failed.id,
          phone: failed.phone,
          message: typedError.message,
          stack: typedError.stack,
        },
        'Failed message replay failed',
      );
    }
  }
}
