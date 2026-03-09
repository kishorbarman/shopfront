import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import {
  enqueueFailedMessage,
  listPendingFailedMessages,
  markFailedMessageProcessed,
} from '../src/services/failedMessageQueue';
import type { InboundMessage } from '../src/models/types';

test('failed message queue stores and replays records', async () => {
  const phone = `+1777${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')}`;

  const message: InboundMessage = {
    id: `SM${Date.now()}`,
    from: phone,
    to: '+15555555555',
    body: 'Change haircut to $30',
    mediaUrls: [],
    channel: 'sms',
    timestamp: new Date(),
  };

  const record = await enqueueFailedMessage(message, new Error('simulated processing failure'), 3);
  assert.equal(record.phone, phone);
  assert.equal(record.retries, 3);

  const pending = await listPendingFailedMessages(200);
  const pendingRecord = pending.find((item) => item.id === record.id);
  assert.ok(pendingRecord, 'queued failed message should be in pending list');

  await markFailedMessageProcessed(record.id);

  const pendingAfterProcess = await listPendingFailedMessages(200);
  assert.equal(
    pendingAfterProcess.some((item) => item.id === record.id),
    false,
    'processed failed message should not remain pending',
  );

  await prisma.failedMessage.delete({ where: { id: record.id } });
});
