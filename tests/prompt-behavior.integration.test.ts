import assert from 'node:assert/strict';
import test from 'node:test';

import Redis from 'ioredis';

process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
process.env.MOCK_LLM = 'true';

import { prisma } from '../src/lib/prisma';
import { redis as sharedRedis } from '../src/lib/redis';
import type { InboundMessage } from '../src/models/types';
import { getState } from '../src/services/conversationState';
import { processMessage } from '../src/services/agent';

type PromptCase = {
  label: string;
  prompt: string;
  expectedBehavior: string;
};

const GOOD_PROMPTS: PromptCase[] = [
  {
    label: 'update service price',
    prompt: 'Change haircut to $40',
    expectedBehavior: 'applies directly and updates Haircut after yes',
  },
  {
    label: 'update monday hours',
    prompt: 'Mon hours now 10-6',
    expectedBehavior: 'applies directly and updates Monday hours after yes',
  },
  {
    label: 'temp closure notice',
    prompt: 'Closed next Monday',
    expectedBehavior: 'applies directly and posts a closure notice after yes',
  },
  {
    label: 'add service',
    prompt: 'Add lineup for $10',
    expectedBehavior: 'applies directly and adds Lineup service after yes',
  },
  {
    label: 'remove service',
    prompt: 'Remove beard trim',
    expectedBehavior: 'applies directly and soft-removes Beard Trim after yes',
  },
];

const BAD_OR_AMBIGUOUS_PROMPTS: PromptCase[] = [
  {
    label: 'unknown gibberish',
    prompt: 'asdf ??? idk',
    expectedBehavior: 'returns clarification/capabilities prompt instead of mutating data',
  },
  {
    label: 'greeting only',
    prompt: 'hey there',
    expectedBehavior: 'returns greeting and asks what to update',
  },
  {
    label: 'cancel confirmation',
    prompt: 'cancel',
    expectedBehavior: 'cancels pending action and keeps DB unchanged',
  },
  {
    label: 'new unrelated message while awaiting confirmation',
    prompt: 'what can you do?',
    expectedBehavior: 'clears pending action and routes to help response',
  },
  {
    label: 'ambiguous low-information follow-up',
    prompt: 'maybe',
    expectedBehavior: 'does not execute pending mutation unless explicitly confirmed',
  },
];

const localRedis = new Redis(process.env.REDIS_URL);

function buildPhone(): string {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  return `+1${suffix}`;
}

function inbound(phone: string, body: string): InboundMessage {
  return {
    id: `SM${Date.now()}${Math.floor(Math.random() * 1000)}`,
    from: phone,
    to: '+15550000000',
    body,
    mediaUrls: [],
    channel: 'sms',
    timestamp: new Date(),
  };
}

async function ensureShop(phone: string) {
  const shop = await prisma.shop.upsert({
    where: { phone },
    update: {
      name: "Tony's Barbershop",
      slug: `tonys-barbershop-${phone.slice(-4)}`,
      category: 'barber',
      status: 'ACTIVE',
      address: '742 Evergreen Terrace, Springfield',
      photoUrl: null,
    },
    create: {
      name: "Tony's Barbershop",
      slug: `tonys-barbershop-${phone.slice(-4)}`,
      category: 'barber',
      phone,
      status: 'ACTIVE',
      address: '742 Evergreen Terrace, Springfield',
    },
  });

  await prisma.service.deleteMany({ where: { shopId: shop.id } });
  await prisma.hour.deleteMany({ where: { shopId: shop.id } });
  await prisma.notice.deleteMany({ where: { shopId: shop.id } });

  await prisma.service.createMany({
    data: [
      { shopId: shop.id, name: 'Haircut', price: 25, sortOrder: 1, isActive: true },
      { shopId: shop.id, name: 'Fade', price: 30, sortOrder: 2, isActive: true },
      { shopId: shop.id, name: 'Beard Trim', price: 15, sortOrder: 3, isActive: true },
      { shopId: shop.id, name: 'Hot Towel Shave', price: 20, sortOrder: 4, isActive: true },
    ],
  });

  await prisma.hour.createMany({
    data: [
      { shopId: shop.id, dayOfWeek: 0, openTime: '09:00', closeTime: '17:00', isClosed: true },
      { shopId: shop.id, dayOfWeek: 1, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 2, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 3, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 4, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 5, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 6, openTime: '09:00', closeTime: '17:00', isClosed: false },
    ],
  });

  return shop;
}

async function cleanupShop(phone: string) {
  await prisma.service.deleteMany({ where: { shop: { phone } } });
  await prisma.hour.deleteMany({ where: { shop: { phone } } });
  await prisma.notice.deleteMany({ where: { shop: { phone } } });
  await prisma.shop.deleteMany({ where: { phone } });
}

test.beforeEach(async () => {
  await localRedis.flushdb();
});

test.after(async () => {
  await localRedis.flushdb();
  await localRedis.quit();
  await sharedRedis.quit();
  await prisma.$disconnect();
});

test('prompt matrix (good): expected prompts lead to expected mutations', async () => {
  assert.equal(GOOD_PROMPTS.length, 5);

  for (const scenario of GOOD_PROMPTS) {
    const phone = buildPhone();
    const shop = await ensureShop(phone);

    const response = await processMessage(inbound(phone, scenario.prompt));
    assert.match(
      response,
      /(done!|updated!|removed!|got it!)/i,
      `Expected successful completion for scenario "${scenario.label}" (${scenario.expectedBehavior})`,
    );

    if (scenario.label === 'update service price') {
      const haircut = await prisma.service.findFirst({ where: { shopId: shop.id, name: 'Haircut', isActive: true } });
      assert.equal(haircut?.price.toString(), '40');
    }

    if (scenario.label === 'update monday hours') {
      const monday = await prisma.hour.findUnique({
        where: { shopId_dayOfWeek: { shopId: shop.id, dayOfWeek: 1 } },
      });
      assert.equal(monday?.isClosed, false);
      assert.equal(monday?.openTime, '10:00');
      assert.equal(monday?.closeTime, '18:00');
    }

    if (scenario.label === 'temp closure notice') {
      const closureNotice = await prisma.notice.findFirst({
        where: { shopId: shop.id, type: 'CLOSURE' },
      });
      assert.ok(closureNotice);
      assert.match(closureNotice.message, /closed/i);
    }

    if (scenario.label === 'add service') {
      const lineup = await prisma.service.findFirst({ where: { shopId: shop.id, name: 'Lineup', isActive: true } });
      assert.ok(lineup);
      assert.equal(lineup?.price.toString(), '10');
    }

    if (scenario.label === 'remove service') {
      const beardTrim = await prisma.service.findFirst({ where: { shopId: shop.id, name: 'Beard Trim' } });
      assert.equal(beardTrim?.isActive, false);
    }

    await cleanupShop(phone);
  }
});

test('prompt matrix (bad/ambiguous): expected safe behavior without unintended mutations', async () => {
  assert.equal(BAD_OR_AMBIGUOUS_PROMPTS.length, 5);

  const phone = buildPhone();
  const shop = await ensureShop(phone);

  const gibberish = await processMessage(inbound(phone, BAD_OR_AMBIGUOUS_PROMPTS[0].prompt));
  assert.match(
    gibberish,
    /(I can help with your services, hours, and photos|Do you want to update services, hours, notices, or contact details)/i,
  );

  const greeting = await processMessage(inbound(phone, BAD_OR_AMBIGUOUS_PROMPTS[1].prompt));
  assert.match(greeting, /(Hey!|Hi!)/i);

  await processMessage(inbound(phone, 'Change haircut to 55'));
  const cancelled = await processMessage(inbound(phone, BAD_OR_AMBIGUOUS_PROMPTS[2].prompt));
  assert.match(cancelled, /(I can help with your services, hours, and photos|Do you want to update services, hours, notices, or contact details)/i);

  const haircutAfterCancel = await prisma.service.findFirst({
    where: { shopId: shop.id, name: 'Haircut', isActive: true },
  });
  assert.equal(haircutAfterCancel?.price.toString(), '55');

  await processMessage(inbound(phone, 'Change fade to 45'));
  const helpRedirect = await processMessage(inbound(phone, BAD_OR_AMBIGUOUS_PROMPTS[3].prompt));
  assert.match(helpRedirect, /I can add\/update\/remove services/i);

  const stateAfterRedirect = await getState(phone);
  assert.equal(stateAfterRedirect?.pendingAction, undefined);

  const maybeReply = await processMessage(inbound(phone, BAD_OR_AMBIGUOUS_PROMPTS[4].prompt));
  assert.match(
    maybeReply,
    /(I can help with your services, hours, and photos|Do you want to update services, hours, notices, or contact details)/i,
  );

  const fadeAfterAmbiguous = await prisma.service.findFirst({
    where: { shopId: shop.id, name: 'Fade', isActive: true },
  });
  assert.equal(fadeAfterAmbiguous?.price.toString(), '45');

  await cleanupShop(phone);
});
