import { prisma } from '../src/lib/prisma';
import logger from '../src/lib/logger';
import { processMessage } from '../src/services/agent';
import {
  listPendingFailedMessages,
  markFailedMessageProcessed,
  updateFailedMessageError,
} from '../src/services/failedMessageQueue';
import { sendMessage } from '../src/services/messaging';
import type { InboundMessage } from '../src/models/types';

async function replayFailedMessages(): Promise<void> {
  const failedMessages = await listPendingFailedMessages(100);

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
      const payload = failed.payload as unknown as InboundMessage;
      const response = await processMessage(payload);

      await sendMessage({
        to: payload.from,
        body: response,
        channel: payload.channel,
      });

      await markFailedMessageProcessed(failed.id);

      logger.info(
        {
          event: 'failed_message_replayed',
          id: failed.id,
          phone: failed.phone,
          channel: failed.channel,
        },
        'Failed message replayed successfully',
      );
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

replayFailedMessages()
  .catch((error) => {
    const typedError = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        event: 'error',
        type: typedError.name,
        message: typedError.message,
        stack: typedError.stack,
      },
      'Replay script failed',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
