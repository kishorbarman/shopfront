import assert from 'node:assert/strict';
import test from 'node:test';
import Redis from 'ioredis';

process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
process.env.MOCK_LLM = 'true';

import { prisma } from '../src/lib/prisma';
import { redis as sharedRedis } from '../src/lib/redis';
import type { InboundMessage } from '../src/models/types';
import { processMessage } from '../src/services/agent';

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

async function clearShopDataByPhone(targetPhone: string): Promise<void> {
  const shops = await prisma.shop.findMany({
    where: { phone: targetPhone },
    select: { id: true },
  });

  if (shops.length === 0) {
    return;
  }

  const shopIds = shops.map((shop) => shop.id);

  await prisma.service.deleteMany({ where: { shopId: { in: shopIds } } });
  await prisma.hour.deleteMany({ where: { shopId: { in: shopIds } } });
  await prisma.notice.deleteMany({ where: { shopId: { in: shopIds } } });
  await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
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

test('full onboarding happy path creates shop, services, and hours', async () => {
  const phone = buildPhone();

  const r1 = await processMessage(inbound(phone, 'Hi'));
  assert.match(r1, /What's your business called\?/i);

  const r2 = await processMessage(inbound(phone, "Tony's Barbershop"));
  assert.match(r2, /What kind of business is Tony's Barbershop/i);

  const r3 = await processMessage(inbound(phone, 'Barber'));
  assert.match(r3, /List your services and prices/i);

  const r4 = await processMessage(inbound(phone, 'Haircut 25, fade 30'));
  assert.match(r4, /Look right\?/i);
  assert.match(r4, /Haircut/i);
  assert.match(r4, /Fade/i);

  const r5 = await processMessage(inbound(phone, 'Yes'));
  assert.match(r5, /What are your hours\?/i);

  const r6 = await processMessage(inbound(phone, 'Mon-Sat 9-7, closed Sunday'));
  assert.match(r6, /What's your address\?/i);

  const r7 = await processMessage(inbound(phone, '742 Evergreen Terrace, Springfield'));
  assert.match(r7, /Your page is live!/i);
  assert.match(r7, /tonys-barbershop(?:-\d+)?/i);

  const shop = await prisma.shop.findUnique({
    where: { phone },
    include: {
      services: true,
      hours: true,
    },
  });

  assert.ok(shop);
  assert.equal(shop?.name, "Tony's Barbershop");
  assert.equal(shop?.status, 'ACTIVE');
  assert.match(shop?.slug ?? '', /^tonys-barbershop(?:-\d+)?$/);
  assert.equal(shop?.services.length, 2);
  assert.equal(shop?.hours.length, 7);

  const sunday = shop?.hours.find((hour) => hour.dayOfWeek === 0);
  assert.ok(sunday);
  assert.equal(sunday?.isClosed, true);

  await clearShopDataByPhone(phone);
});

test('onboarding can finish early with Done after business name and create placeholders', async () => {
  const phone = buildPhone();

  await processMessage(inbound(phone, 'Hi'));
  await processMessage(inbound(phone, 'Luna Studio'));

  const done = await processMessage(inbound(phone, 'Done'));
  assert.match(done, /starter page is live!/i);
  assert.match(done, /used placeholders/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: {
      services: true,
      hours: true,
    },
  });

  assert.equal(shop.name, 'Luna Studio');
  assert.equal(shop.category, 'general');
  assert.equal(shop.status, 'ACTIVE');
  assert.equal(shop.address, 'Address coming soon');

  assert.equal(shop.services.length, 1);
  assert.equal(shop.services[0]?.name, 'Services coming soon');
  assert.equal(shop.services[0]?.price.toString(), '0');

  assert.equal(shop.hours.length, 7);
  assert.ok(shop.hours.every((hour) => hour.isClosed));

  await clearShopDataByPhone(phone);
});

test('onboarding Done preserves provided details and fills only missing fields', async () => {
  const phone = buildPhone();

  await processMessage(inbound(phone, 'Hi'));
  await processMessage(inbound(phone, 'Nova Nails'));
  await processMessage(inbound(phone, 'Salon'));
  await processMessage(inbound(phone, 'Manicure 30, Pedicure 45'));

  const done = await processMessage(inbound(phone, 'Done'));
  assert.match(done, /starter page is live!/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: {
      services: true,
      hours: true,
    },
  });

  assert.equal(shop.category, 'salon');
  assert.equal(shop.services.length, 2);
  assert.equal(shop.address, 'Address coming soon');
  assert.equal(shop.hours.length, 7);

  await clearShopDataByPhone(phone);
});
