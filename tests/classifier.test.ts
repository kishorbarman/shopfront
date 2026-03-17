import assert from 'node:assert/strict';
import test from 'node:test';

process.env.MOCK_LLM = 'true';

import { classifyIntent } from '../src/agent/classifier';
import type { IntentCategory } from '../src/agent/intents';

const context = {
  name: "Tony's Barbershop",
  services: ['Haircut', 'Fade', 'Beard Trim', 'Hot Towel Shave'],
};

const history = [
  { role: 'user', content: 'Change the fade price' },
  { role: 'agent', content: 'Sure, what should it be?' },
];

const examplesByIntent: Record<IntentCategory, string[]> = {
  add_service: [
    'Add lineup for $10',
    'New service: braids 45',
    'Include beard color for 12',
    'Offer razor line up $15',
    'Add kids lineup 8',
    'HairColor $30',
    'Haircolor:$30',
  ],
  update_service: [
    'Change haircut to $28',
    'chg fade to 35 pls',
    'update beard trim to 18',
    'set hot towel shave 25',
    'make fade 40 now',
  ],
  remove_service: [
    'Remove hot towel shave',
    'Delete kids cut',
    'Drop beard trim from menu',
    'Take off fade',
    'Remove haircut service',
  ],
  update_hours: [
    'Open til 8 on Fridays',
    'Mon hours now 10-6',
    'Close at 7 tonight',
    'Opening at 11 tomorrow',
    'Update Sunday hours to 9-2',
    'Update hours we are closed on Sunday',
  ],
  temp_closure: [
    'Closed next Monday',
    'On vacation next week',
    'Temporarily closed tomorrow',
    'Closed on Tuesday only',
    'Temp closed for holiday',
  ],
  update_contact: [
    'New number is 555-1234',
    'Update address to 12 Main St',
    'Change contact phone to 5557778888',
    'Reach me at this new number',
    'New contact address is 90 King Ave',
  ],
  update_photo: [
    'Make this my main photo',
    'Use this picture for banner',
    'Set this image as profile',
    'Update my photo please',
    'Use this as main picture',
  ],
  add_notice: [
    'Put up a sign: cash only',
    'Post notice: closed early today',
    'Add announcement: we moved',
    'Notice says card machine down',
    'Put this sign up: back at 2pm',
  ],
  remove_notice: [
    'Take down the vacation notice',
    'Remove notice',
    'Delete notice from page',
    'Remove that sign now',
    'Take down notice about closure',
  ],
  query: [
    "What's my fade price?",
    'Show my hours',
    'List my services',
    'How much is haircut',
    'What are my hours?',
  ],
  greeting: ['Hey there', 'Hi', 'Hello', 'Yo', 'Sup man'],
  help: ['What can you do?', 'Help me', 'Commands?', 'How does this work?', 'I need help'],
  unknown: ['asdf ??? idk', 'qwerty', 'blarg snarg', 'hmmm maybe', 'random words only'],
};

test('classifier maps 5+ messages per intent category', async () => {
  for (const [intent, messages] of Object.entries(examplesByIntent) as Array<[
    IntentCategory,
    string[],
  ]>) {
    assert.ok(messages.length >= 5, `Intent ${intent} must have at least 5 examples`);

    for (const message of messages) {
      const result = await classifyIntent(message, context, history, { hasMedia: true });
      assert.equal(result.intent, intent, `Failed message for ${intent}: ${message}`);
    }
  }
});

test('classifier marks low-confidence unknown messages for clarification', async () => {
  const result = await classifyIntent('asdf ??? idk', context, history);

  assert.equal(result.intent, 'unknown');
  assert.equal(result.needsClarification, true);
  assert.ok(result.clarificationQuestion);
});

test('classifier uses shop context to increase update_service confidence', async () => {
  const withServiceContext = await classifyIntent('chg fade to 35 pls', context, history);
  const withoutServiceContext = await classifyIntent(
    'chg style to 35 pls',
    { name: context.name, services: [] },
    history,
  );

  assert.equal(withServiceContext.intent, 'update_service');
  assert.equal(withoutServiceContext.intent, 'update_service');
  assert.ok(withServiceContext.confidence > withoutServiceContext.confidence);
});

test('classifier forces update_photo when media + photo phrasing are present', async () => {
  const result = await classifyIntent('make this my profile picture', context, history, {
    hasMedia: true,
  });

  assert.equal(result.intent, 'update_photo');
  assert.equal(result.needsClarification, false);
});

test('classifier prefers update_hours over temp_closure for regular weekly schedule edits', async () => {
  const result = await classifyIntent('Update hours we are closed on Sunday', context, history);

  assert.equal(result.intent, 'update_hours');
  assert.equal(result.needsClarification, false);
});
