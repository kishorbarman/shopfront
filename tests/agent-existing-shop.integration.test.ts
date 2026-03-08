import assert from 'node:assert/strict';
import test from 'node:test';
import Redis from 'ioredis';

process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
process.env.MOCK_ANTHROPIC = 'true';

import { prisma } from '../src/lib/prisma';
import { redis as sharedRedis } from '../src/lib/redis';
import type { InboundMessage } from '../src/models/types';
import { processMessage } from '../src/services/agent';

const localRedis = new Redis(process.env.REDIS_URL);

function buildPhone(): string {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  return `+1${suffix}`;
}

function inbound(phone: string, body: string, mediaUrls: string[] = []): InboundMessage {
  return {
    id: `SM${Date.now()}${Math.floor(Math.random() * 1000)}`,
    from: phone,
    to: '+15550000000',
    body,
    mediaUrls,
    channel: 'sms',
    timestamp: new Date(),
  };
}

async function ensureShop(phone: string) {
  await prisma.shop.upsert({
    where: { phone },
    update: {
      name: "Tony's Barbershop",
      slug: `tonys-barbershop-${phone.slice(-4)}`,
      category: 'barber',
      status: 'ACTIVE',
    },
    create: {
      name: "Tony's Barbershop",
      slug: `tonys-barbershop-${phone.slice(-4)}`,
      category: 'barber',
      phone,
      status: 'ACTIVE',
    },
  });

  const shop = await prisma.shop.findUniqueOrThrow({ where: { phone } });

  await prisma.service.deleteMany({ where: { shopId: shop.id } });
  await prisma.service.createMany({
    data: [
      { shopId: shop.id, name: 'Haircut', price: 25, sortOrder: 1, isActive: true },
      { shopId: shop.id, name: 'Fade', price: 30, sortOrder: 2, isActive: true },
    ],
  });
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

test('existing shop messages use classification + router stubs', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const r1 = await processMessage(inbound(phone, 'Change haircut to $28'));
  assert.match(r1, /update that service/i);

  const r2 = await processMessage(inbound(phone, 'Hey'));
  assert.match(r2, /here to help/i);

  const r3 = await processMessage(inbound(phone, 'What can you do?'));
  assert.match(r3, /I can add\/update\/remove services/i);

  const r4 = await processMessage(inbound(phone, 'Make this my main photo', ['https://example.com/photo.jpg']));
  assert.match(r4, /update your photo/i);

  const r5 = await processMessage(inbound(phone, 'blarg snarg ???'));
  assert.match(r5, /Do you want to update services, hours, notices, or contact details\?/i);

  await cleanupShop(phone);
});
