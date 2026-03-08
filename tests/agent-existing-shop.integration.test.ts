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
  const shop = await prisma.shop.upsert({
    where: { phone },
    update: {
      name: "Tony's Barbershop",
      slug: `tonys-barbershop-${phone.slice(-4)}`,
      category: 'barber',
      status: 'ACTIVE',
      address: '742 Evergreen Terrace, Springfield',
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

  await prisma.notice.create({
    data: {
      shopId: shop.id,
      message: 'Closed Monday',
      type: 'INFO',
      startsAt: new Date(),
    },
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

test('confirm then execute update_service mutation', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const confirmation = await processMessage(inbound(phone, 'Change fade to $35'));
  assert.match(confirmation, /sound good\?/i);

  const done = await processMessage(inbound(phone, 'yes'));
  assert.match(done, /Updated! Fade is now \$35/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: { services: true },
  });
  const fade = shop.services.find((service) => service.name === 'Fade');
  assert.equal(fade?.price.toString(), '35');

  await cleanupShop(phone);
});

test('cancel pending mutation does not update DB', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  await processMessage(inbound(phone, 'Change haircut to 50'));
  const cancelled = await processMessage(inbound(phone, 'cancel'));
  assert.match(cancelled, /cancelled/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: { services: true },
  });
  const haircut = shop.services.find((service) => service.name === 'Haircut');
  assert.equal(haircut?.price.toString(), '25');

  await cleanupShop(phone);
});

test('new unrelated message while awaiting confirmation redirects to new classification', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  await processMessage(inbound(phone, 'Change haircut to 40'));
  const redirected = await processMessage(inbound(phone, 'What can you do?'));
  assert.match(redirected, /I can add\/update\/remove services/i);

  await cleanupShop(phone);
});

test('query responses return current services, hours, and notices', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const serviceQuery = await processMessage(inbound(phone, 'What is my fade price?'));
  assert.match(serviceQuery, /Fade is currently \$30/i);

  const hoursQuery = await processMessage(inbound(phone, 'Show my hours'));
  assert.match(hoursQuery, /Your current hours:/i);

  const noticeQuery = await processMessage(inbound(phone, 'Show notices'));
  assert.match(noticeQuery, /Closed Monday/i);

  await cleanupShop(phone);
});

test('fuzzy service matching updates abbreviations/typos', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  await processMessage(inbound(phone, 'Change hot towel to 22'));
  const done = await processMessage(inbound(phone, 'yes'));
  assert.match(done, /Updated!/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: { services: true },
  });
  const service = shop.services.find((s) => s.name === 'Hot Towel Shave');
  assert.equal(service?.price.toString(), '22');

  await cleanupShop(phone);
});
