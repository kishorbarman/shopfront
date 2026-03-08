import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { Hour, Notice, Service, Shop, ShopStatus } from '@prisma/client';

import { generateShopPage } from '../src/templates/generator';

function sampleShop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: 'shop-1',
    name: "Tony's Barbershop",
    slug: 'tonys-barbershop',
    category: 'barber',
    phone: '+15551234567',
    address: '742 Evergreen Terrace, Springfield',
    latitude: null,
    longitude: null,
    photoUrl: null,
    status: 'ACTIVE' as ShopStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function sampleServices(): Service[] {
  return [
    {
      id: 'svc-1',
      shopId: 'shop-1',
      name: 'Haircut',
      price: 25 as unknown as Service['price'],
      description: 'Classic cut with line-up',
      sortOrder: 1,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'svc-2',
      shopId: 'shop-1',
      name: 'Fade',
      price: 30 as unknown as Service['price'],
      description: 'Low, mid, or high fade',
      sortOrder: 2,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function sampleHours(): Hour[] {
  return Array.from({ length: 7 }).map((_, day) => ({
    id: `h-${day}`,
    shopId: 'shop-1',
    dayOfWeek: day,
    openTime: '09:00',
    closeTime: '19:00',
    isClosed: day === 0,
  }));
}

function sampleNotices(): Notice[] {
  return [
    {
      id: 'n-1',
      shopId: 'shop-1',
      message: 'Cash only today',
      type: 'WARNING',
      startsAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
    },
  ];
}

test('generates services template with required sections and seo tags', async () => {
  const html = await generateShopPage({
    ...sampleShop(),
    services: sampleServices(),
    hours: sampleHours(),
    notices: sampleNotices(),
  });

  assert.match(html, /<title>Tony&#39;s Barbershop - Barber \| Services &amp; Hours<\/title>/);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /Powered by Shopfront/);
  assert.match(html, /Cash only today/);
  assert.match(html, /href="tel:\+15551234567"/);
  assert.match(html, /href="sms:\+15551234567"/);
  assert.match(html, /Open in Google Maps/);
  assert.match(html, /hours-table/);

  const bytes = Buffer.byteLength(html, 'utf8');
  assert.ok(bytes < 50 * 1024);
});

test('generates menu template for restaurant category', async () => {
  const html = await generateShopPage({
    ...sampleShop({
      id: 'shop-2',
      name: 'Sunset Tacos',
      slug: 'sunset-tacos',
      category: 'restaurant',
      phone: '+15557654321',
    }),
    services: [
      {
        id: 'svc-r1',
        shopId: 'shop-2',
        name: 'Al Pastor Taco',
        price: 6.5 as unknown as Service['price'],
        description: 'Pineapple, onion, cilantro',
        sortOrder: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    hours: sampleHours().map((hour) => ({ ...hour, shopId: 'shop-2' })),
    notices: [],
  });

  assert.match(html, /<h2>Menu<\/h2>/);
  assert.match(html, /menu-grid/);
  assert.match(html, /Al Pastor Taco/);
  assert.match(html, /\$6.50/);
});

test('writes visual preview html files for manual review', async () => {
  const outputDir = path.join(process.cwd(), 'tests', 'visual-output');
  await mkdir(outputDir, { recursive: true });

  const barberHtml = await generateShopPage({
    ...sampleShop(),
    services: sampleServices(),
    hours: sampleHours(),
    notices: sampleNotices(),
  });

  const restaurantHtml = await generateShopPage({
    ...sampleShop({
      id: 'shop-2',
      name: 'Sunset Tacos',
      slug: 'sunset-tacos',
      category: 'restaurant',
      phone: '+15557654321',
    }),
    services: [
      {
        id: 'svc-r1',
        shopId: 'shop-2',
        name: 'Al Pastor Taco',
        price: 6.5 as unknown as Service['price'],
        description: 'Pineapple, onion, cilantro',
        sortOrder: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'svc-r2',
        shopId: 'shop-2',
        name: 'Horchata',
        price: 4 as unknown as Service['price'],
        description: 'Fresh cinnamon rice drink',
        sortOrder: 2,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    hours: sampleHours().map((hour) => ({ ...hour, shopId: 'shop-2' })),
    notices: [],
  });

  await writeFile(path.join(outputDir, 'tonys-barbershop.html'), barberHtml, 'utf8');
  await writeFile(path.join(outputDir, 'sunset-tacos.html'), restaurantHtml, 'utf8');

  assert.ok(Buffer.byteLength(barberHtml, 'utf8') > 1000);
  assert.ok(Buffer.byteLength(restaurantHtml, 'utf8') > 1000);
});
