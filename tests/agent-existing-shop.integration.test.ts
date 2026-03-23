import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Redis from 'ioredis';
import sharp from 'sharp';

process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
process.env.MOCK_LLM = 'true';

import { prisma } from '../src/lib/prisma';
import { redis as sharedRedis } from '../src/lib/redis';
import type { InboundMessage } from '../src/models/types';
import { getState } from '../src/services/conversationState';
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
  const shop = await prisma.shop.findUnique({ where: { phone }, select: { id: true } });
  if (shop?.id) {
    await fs.rm(path.join(process.cwd(), 'public', 'uploads', shop.id), { recursive: true, force: true });
  }

  await prisma.service.deleteMany({ where: { shop: { phone } } });
  await prisma.hour.deleteMany({ where: { shop: { phone } } });
  await prisma.notice.deleteMany({ where: { shop: { phone } } });
  await prisma.shop.deleteMany({ where: { phone } });
}

async function makeTempImagePath(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shopfront-photo-'));
  const filePath = path.join(dir, `${prefix}.jpg`);
  await sharp({
    create: {
      width: 900,
      height: 600,
      channels: 3,
      background: { r: 100, g: 120, b: 220 },
    },
  })
    .jpeg()
    .toFile(filePath);

  return filePath;
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

test('update_service mutation applies immediately without yes confirmation', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const done = await processMessage(inbound(phone, 'Change fade to $35'));
  assert.match(done, /Updated! Fade is now \$35/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: { services: true },
  });
  const fade = shop.services.find((service) => service.name === 'Fade');
  assert.equal(fade?.price.toString(), '35');

  const state = await getState(phone);
  assert.notEqual(state?.mode, 'awaiting_confirmation');
  assert.equal(state?.pendingAction, undefined);

  await cleanupShop(phone);
});

test('follow-up cancel does not revert an already-applied mutation', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  await processMessage(inbound(phone, 'Change haircut to 50'));
  const cancelReply = await processMessage(inbound(phone, 'cancel'));
  assert.match(cancelReply, /services, hours|contact details|what would you like to update/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: { services: true },
  });
  const haircut = shop.services.find((service) => service.name === 'Haircut');
  assert.equal(haircut?.price.toString(), '50');

  await cleanupShop(phone);
});

test('new unrelated message routes normally after immediate mutation apply', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  await processMessage(inbound(phone, 'Change haircut to 40'));
  const redirected = await processMessage(inbound(phone, 'What can you do?'));
  assert.match(redirected, /I can add\/update\/remove services/i);

  const state = await getState(phone);
  assert.notEqual(state?.mode, 'awaiting_confirmation');
  assert.equal(state?.pendingAction, undefined);

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

test('fuzzy service matching updates abbreviations/typos immediately', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const done = await processMessage(inbound(phone, 'Change hot towel to 22'));
  assert.match(done, /Updated!/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: { services: true },
  });
  const service = shop.services.find((s) => s.name === 'Hot Towel Shave');
  assert.equal(service?.price.toString(), '22');

  await cleanupShop(phone);
});

test('photo with banner intent updates shop photoUrl and stores processed image', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const imagePath = await makeTempImagePath('banner');
  const response = await processMessage(
    inbound(phone, 'Make this my main photo', [`file://${encodeURIComponent(imagePath)}`]),
  );

  assert.match(response, /new banner photo is live/i);

  const shop = await prisma.shop.findUniqueOrThrow({ where: { phone } });
  assert.ok(shop.photoUrl);

  const storedPath = path.join(process.cwd(), shop.photoUrl!.replace(/^\//, ''));
  const storedMeta = await sharp(storedPath).metadata();
  assert.equal(storedMeta.format, 'webp');
  assert.ok((storedMeta.width ?? 0) <= 1200);

  await fs.rm(path.dirname(imagePath), { recursive: true, force: true });
  await cleanupShop(phone);
});

test('photo without context asks banner/gallery and gallery choice is applied', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const imagePath = await makeTempImagePath('gallery');
  const first = await processMessage(inbound(phone, '', [`file://${encodeURIComponent(imagePath)}`]));
  assert.match(first, /main banner|gallery/i);

  const state = await getState(phone);
  assert.equal(state?.mode, 'awaiting_confirmation');
  assert.equal(state?.pendingAction?.intent, 'update_photo');

  const second = await processMessage(inbound(phone, 'gallery'));
  assert.match(second, /added .*gallery|added this photo to your gallery/i);

  const shop = await prisma.shop.findUniqueOrThrow({ where: { phone } });
  assert.equal(shop.photoUrl, null);

  const galleryPath = path.join(process.cwd(), 'public', 'uploads', shop.id, 'gallery.json');
  const galleryRaw = await fs.readFile(galleryPath, 'utf8');
  const galleryEntries = JSON.parse(galleryRaw) as Array<{ url: string; thumbnailUrl: string }>;
  assert.ok(galleryEntries.length >= 1);
  assert.ok(galleryEntries[0].url.includes('/public/uploads/'));

  await fs.rm(path.dirname(imagePath), { recursive: true, force: true });
  await cleanupShop(phone);
});

test('hours update phrasing does not create temp closure notice', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const shop = await prisma.shop.findUniqueOrThrow({ where: { phone } });
  await prisma.hour.updateMany({
    where: { shopId: shop.id, dayOfWeek: 0 },
    data: { isClosed: false, openTime: '09:00', closeTime: '17:00' },
  });

  const noticesBefore = await prisma.notice.count({ where: { shopId: shop.id } });
  const response = await processMessage(inbound(phone, 'Update hours we are closed on Sunday'));
  assert.match(response, /Updated! Hours changed:/i);

  const sunday = await prisma.hour.findFirstOrThrow({
    where: { shopId: shop.id, dayOfWeek: 0 },
  });
  assert.equal(sunday.isClosed, true);

  const noticesAfter = await prisma.notice.count({ where: { shopId: shop.id } });
  assert.equal(noticesAfter, noticesBefore);

  await cleanupShop(phone);
});

test('delete website requires exact same message repeated and then purges data', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const seededShop = await prisma.shop.findUniqueOrThrow({ where: { phone } });
  await prisma.channelIdentity.create({
    data: {
      shopId: seededShop.id,
      channel: 'telegram',
      externalUserId: 'tg-' + phone,
      externalSpaceId: 'tg-' + phone,
    },
  });

  const first = await processMessage(inbound(phone, 'delete my website'));
  assert.match(first, /repeat this exact message/i);

  const beforeDelete = await prisma.shop.findUnique({ where: { phone } });
  assert.ok(beforeDelete);

  const second = await processMessage(inbound(phone, 'delete my website'));
  assert.match(second, /permanently deleted/i);

  const afterDelete = await prisma.shop.findUnique({ where: { phone } });
  assert.equal(afterDelete, null);

  const identityCount = await prisma.channelIdentity.count({ where: { shopId: seededShop.id } });
  assert.equal(identityCount, 0);

  const state = await getState(phone);
  assert.equal(state, null);
  assert.equal(await localRedis.exists(`state:${phone}`), 0);
  assert.equal(await localRedis.exists(`history:${phone}`), 0);
  assert.equal(await localRedis.exists(`rate:${phone}`), 0);
});

test('delete website does not execute when second message does not exactly match', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const first = await processMessage(inbound(phone, 'delete my website'));
  assert.match(first, /repeat this exact message/i);

  const second = await processMessage(inbound(phone, 'delete my website now'));
  assert.match(second, /repeat this exact message/i);

  const shopStillExists = await prisma.shop.findUnique({ where: { phone } });
  assert.ok(shopStillExists);

  const cancel = await processMessage(inbound(phone, 'no'));
  assert.match(cancel, /deletion cancelled/i);

  await cleanupShop(phone);
});

test('update_contact address phrasing does not include leading "is" in stored value', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const response = await processMessage(
    inbound(phone, 'Our address is 123 Main Street, Springfield'),
  );
  assert.match(response, /Updated! address is now 123 Main Street, Springfield\./i);

  const shop = await prisma.shop.findUniqueOrThrow({ where: { phone } });
  assert.equal(shop.address, '123 Main Street, Springfield');

  await cleanupShop(phone);
});

test('bare service with price tag adds service without add verb', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const response = await processMessage(inbound(phone, 'HairColor $30'));
  assert.match(response, /added to your menu/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: { services: true },
  });
  const added = shop.services.find((service) => service.name === 'HairColor');
  assert.ok(added);
  assert.equal(added?.price.toString(), '30');

  await cleanupShop(phone);
});


test('multi-service list adds all services from one message', async () => {
  const phone = buildPhone();
  await ensureShop(phone);

  const response = await processMessage(
    inbound(phone, 'Haircolor $30, Mens haircut $40, Womens haircut $50'),
  );
  assert.match(response, /Added 3 services/i);

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { phone },
    include: { services: true },
  });

  const haircolor = shop.services.find((service) => service.name === 'Haircolor');
  const mens = shop.services.find((service) => service.name === 'Mens Haircut');
  const womens = shop.services.find((service) => service.name === 'Womens Haircut');

  assert.ok(haircolor);
  assert.ok(mens);
  assert.ok(womens);
  assert.equal(haircolor?.price.toString(), '30');
  assert.equal(mens?.price.toString(), '40');
  assert.equal(womens?.price.toString(), '50');

  await cleanupShop(phone);
});
