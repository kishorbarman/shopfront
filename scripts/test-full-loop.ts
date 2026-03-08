import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

process.env.SKIP_TWILIO_VALIDATION = 'true';
process.env.SKIP_TWILIO_SEND = 'true';
process.env.MOCK_ANTHROPIC = 'true';

import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';
import { buildServer } from '../src/index';
import { getSiteOutputPath } from '../src/services/siteBuilder';

function uniquePhone(): string {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  return `+1${suffix}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const app = await buildServer();
  const ownerPhone = uniquePhone();
  const twilioNumber = process.env.TWILIO_SMS_NUMBER ?? '+15550000000';

  let counter = 0;

  async function sendSms(body: string): Promise<void> {
    counter += 1;
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/sms',
      payload: {
        MessageSid: `SM${Date.now()}${counter}`,
        From: ownerPhone,
        To: twilioNumber,
        Body: body,
        NumMedia: '0',
      },
    });

    assert.equal(res.statusCode, 200, `Webhook failed for message: ${body}`);
  }

  try {
    console.log('1) Simulating onboarding conversation via webhook...');
    await sendSms('Hi');
    await sendSms("Tony's Barbershop");
    await sendSms('Barber');
    await sendSms('Haircut 25, fade 30, beard trim 15');
    await sendSms('Yes');
    await sendSms('Mon-Sat 9-7, closed Sunday');
    await sendSms('742 Evergreen Terrace, Springfield');

    const shop = await prisma.shop.findUnique({ where: { phone: ownerPhone } });
    assert.ok(shop, 'Shop should be created after onboarding.');

    const sitePath = getSiteOutputPath(shop.slug);

    let exists = false;
    for (let i = 0; i < 10; i += 1) {
      try {
        await fs.access(sitePath);
        exists = true;
        break;
      } catch {
        await sleep(100);
      }
    }

    assert.ok(exists, `Expected prebuilt site at ${sitePath}`);

    const firstPage = await app.inject({ method: 'GET', url: `/s/${shop.slug}` });
    assert.equal(firstPage.statusCode, 200);
    assert.match(firstPage.body, /Tony&#39;s Barbershop/);
    assert.match(firstPage.body, /\$25/);

    console.log('2) Updating service price via webhook (with confirm)...');
    await sendSms('Change haircut to $30');
    const t1 = Date.now();
    await sendSms('yes');
    const priceUpdateMs = Date.now() - t1;

    const secondPage = await app.inject({ method: 'GET', url: `/s/${shop.slug}` });
    assert.equal(secondPage.statusCode, 200);
    assert.match(secondPage.body, /\$30/);
    assert.ok(priceUpdateMs < 2000, `Price update rebuild exceeded 2s: ${priceUpdateMs}ms`);

    console.log('3) Adding temporary closure notice via webhook...');
    await sendSms('Closed next Monday');
    const t2 = Date.now();
    await sendSms('yes');
    const noticeUpdateMs = Date.now() - t2;

    const thirdPage = await app.inject({ method: 'GET', url: `/s/${shop.slug}` });
    assert.equal(thirdPage.statusCode, 200);
    assert.match(thirdPage.body, /Closed next Monday/i);
    assert.ok(noticeUpdateMs < 2000, `Notice update rebuild exceeded 2s: ${noticeUpdateMs}ms`);

    console.log('4) Adding service via webhook...');
    await sendSms('add lineup for $10');
    const t3 = Date.now();
    await sendSms('yes');
    const addServiceMs = Date.now() - t3;

    const fourthPage = await app.inject({ method: 'GET', url: `/s/${shop.slug}` });
    assert.equal(fourthPage.statusCode, 200);
    assert.match(fourthPage.body, /Lineup/i);
    assert.match(fourthPage.body, /\$10/);
    assert.ok(addServiceMs < 2000, `Add service rebuild exceeded 2s: ${addServiceMs}ms`);

    console.log('5) Verifying cache headers on prebuilt page route...');
    assert.equal(fourthPage.headers['cache-control'], 'public, max-age=300');
    assert.ok(fourthPage.headers.etag);
    assert.ok(fourthPage.headers['last-modified']);

    console.log('Full loop test passed.');
  } finally {
    const shop = await prisma.shop.findUnique({ where: { phone: ownerPhone }, select: { id: true, slug: true } });

    if (shop) {
      await prisma.service.deleteMany({ where: { shopId: shop.id } });
      await prisma.hour.deleteMany({ where: { shopId: shop.id } });
      await prisma.notice.deleteMany({ where: { shopId: shop.id } });
      await prisma.shop.delete({ where: { id: shop.id } });

      const siteDir = path.dirname(getSiteOutputPath(shop.slug));
      await fs.rm(siteDir, { recursive: true, force: true });
      await fs.rm(path.join(process.cwd(), 'public', 'uploads', shop.id), { recursive: true, force: true });
    }

    await app.close();
    await redis.quit();
    await prisma.$disconnect();
  }
}

void run().catch((error) => {
  console.error('Full loop test failed:', error);
  process.exit(1);
});
