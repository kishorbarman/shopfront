import { prisma } from '../src/lib/prisma';
import logger from '../src/lib/logger';
import { replayFailedMessages } from '../src/services/failedMessageReplay';

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
