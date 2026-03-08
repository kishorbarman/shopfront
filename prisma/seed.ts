import { Prisma } from '@prisma/client';

import { prisma } from '../src/lib/prisma';

async function main() {
  const shop = await prisma.shop.upsert({
    where: { phone: '+15550001111' },
    update: {
      name: "Tony's Barbershop",
      slug: 'tonys-barbershop',
      category: 'barber',
      address: '742 Evergreen Terrace, Springfield',
      status: 'ACTIVE',
    },
    create: {
      name: "Tony's Barbershop",
      slug: 'tonys-barbershop',
      category: 'barber',
      phone: '+15550001111',
      address: '742 Evergreen Terrace, Springfield',
      status: 'ACTIVE',
    },
  });

  await prisma.service.deleteMany({ where: { shopId: shop.id } });
  await prisma.hour.deleteMany({ where: { shopId: shop.id } });
  await prisma.notice.deleteMany({ where: { shopId: shop.id } });

  await prisma.service.createMany({
    data: [
      { shopId: shop.id, name: 'Haircut', price: new Prisma.Decimal(25), sortOrder: 1 },
      { shopId: shop.id, name: 'Fade', price: new Prisma.Decimal(30), sortOrder: 2 },
      { shopId: shop.id, name: 'Beard Trim', price: new Prisma.Decimal(15), sortOrder: 3 },
      { shopId: shop.id, name: 'Hot Towel Shave', price: new Prisma.Decimal(20), sortOrder: 4 },
      { shopId: shop.id, name: 'Kids Cut', price: new Prisma.Decimal(18), sortOrder: 5 },
    ],
  });

  await prisma.hour.createMany({
    data: [
      { shopId: shop.id, dayOfWeek: 0, openTime: '09:00', closeTime: '19:00', isClosed: true },
      { shopId: shop.id, dayOfWeek: 1, openTime: '09:00', closeTime: '19:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 2, openTime: '09:00', closeTime: '19:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 3, openTime: '09:00', closeTime: '19:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 4, openTime: '09:00', closeTime: '19:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 5, openTime: '09:00', closeTime: '19:00', isClosed: false },
      { shopId: shop.id, dayOfWeek: 6, openTime: '09:00', closeTime: '19:00', isClosed: false },
    ],
  });

  console.log("Seed complete: Tony's Barbershop created/updated.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
