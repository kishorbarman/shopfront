import assert from 'node:assert/strict';
import test from 'node:test';

import { routeMessage } from '../src/agent/router';
import type { ClassificationResult } from '../src/agent/intents';
import type { InboundMessage } from '../src/models/types';
import type { ConversationState } from '../src/services/conversationState';

const message: InboundMessage = {
  id: 'SM123',
  from: '+15550000001',
  to: '+15550000000',
  body: 'test',
  mediaUrls: [],
  channel: 'sms',
  timestamp: new Date(),
};

const state: ConversationState = {
  mode: 'active',
  shopId: 'shop-1',
  lastMessageAt: new Date().toISOString(),
};

const shop = {
  id: 'shop-1',
  name: "Tony's Barbershop",
  slug: 'tonys-barbershop',
  category: 'barber',
  phone: '+15550000001',
  address: null,
  latitude: null,
  longitude: null,
  photoUrl: null,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

const stubs: Array<{ intent: ClassificationResult['intent']; expected: RegExp }> = [
  { intent: 'add_service', expected: /add that service/i },
  { intent: 'update_service', expected: /update that service/i },
  { intent: 'remove_service', expected: /remove that service/i },
  { intent: 'update_hours', expected: /update your hours/i },
  { intent: 'temp_closure', expected: /temporary closure/i },
  { intent: 'update_contact', expected: /contact details/i },
  { intent: 'update_photo', expected: /update your photo/i },
  { intent: 'add_notice', expected: /add that notice/i },
  { intent: 'remove_notice', expected: /remove that notice/i },
  { intent: 'query', expected: /look that up/i },
  { intent: 'greeting', expected: /here to help/i },
  { intent: 'help', expected: /I can add\/update\/remove services/i },
  { intent: 'unknown', expected: /services, hours, and photos/i },
];

test('router returns stub responses by intent', async () => {
  for (const stub of stubs) {
    const result = await routeMessage(
      message,
      {
        intent: stub.intent,
        confidence: 0.95,
        needsClarification: false,
      },
      state,
      shop,
    );

    assert.match(result, stub.expected);
  }
});

test('router returns clarification question when needed', async () => {
  const result = await routeMessage(
    message,
    {
      intent: 'update_service',
      confidence: 0.4,
      needsClarification: true,
      clarificationQuestion: 'Did you mean haircut or fade?',
    },
    state,
    shop,
  );

  assert.equal(result, 'Did you mean haircut or fade?');
});
