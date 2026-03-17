import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeMessageAction } from '../src/services/messageSummary';
import type { ConversationState } from '../src/services/conversationState';

function stateWithPending(intent: string, data: Record<string, unknown>): ConversationState {
  return {
    mode: 'awaiting_confirmation',
    shopId: 'shop_123',
    lastMessageAt: new Date().toISOString(),
    pendingAction: {
      intent,
      data,
      confirmationMessage: 'confirm',
    },
  };
}

test('summarize update_hours intent with open-day detail', () => {
  const afterState = stateWithPending('update_hours', {
    changes: [{ dayOfWeek: 1, isClosed: false }],
  });

  const summary = summarizeMessageAction({
    messageBody: 'Open Monday',
    beforeState: null,
    afterState,
    updateApplied: false,
    status: 'PROCESSED',
  });

  assert.equal(summary, 'update_hours: changing Monday to Open');
});

test('summarize update_service with price and name details', () => {
  const afterState = stateWithPending('update_service', {
    serviceName: 'Haircut',
    newPrice: 40,
    newName: 'Signature Cut',
  });

  const summary = summarizeMessageAction({
    messageBody: 'Change haircut to 40 and rename it Signature Cut',
    beforeState: null,
    afterState,
    updateApplied: false,
    status: 'PROCESSED',
  });

  assert.equal(summary, 'update_service: changing Haircut price to $40 and name to Signature Cut');
});

test('summarize cancellation when pending action is rejected', () => {
  const beforeState = stateWithPending('update_hours', {
    changes: [{ dayOfWeek: 1, isClosed: false }],
  });

  const afterState: ConversationState = {
    ...beforeState,
    mode: 'active',
    pendingAction: undefined,
  };

  const summary = summarizeMessageAction({
    messageBody: 'cancel',
    beforeState,
    afterState,
    updateApplied: false,
    status: 'PROCESSED',
  });

  assert.equal(summary, 'update_hours: cancelled');
});


test('summarize add_service with multiple services', () => {
  const afterState = stateWithPending('add_service', {
    services: [
      { name: 'Haircolor', price: 30 },
      { name: 'Mens Haircut', price: 40 },
      { name: 'Womens Haircut', price: 50 },
    ],
  });

  const summary = summarizeMessageAction({
    messageBody: 'Haircolor $30, Mens haircut $40, Womens haircut $50',
    beforeState: null,
    afterState,
    updateApplied: false,
    status: 'PROCESSED',
  });

  assert.equal(
    summary,
    'add_service: adding 3 services: Haircolor ($30), Mens Haircut ($40), Womens Haircut ($50)',
  );
});
