import { Prisma } from '@prisma/client';
import type { Shop } from '@prisma/client';

import logger from '../lib/logger';
import { prisma } from '../lib/prisma';
import type { Channel } from '../models/types';

export interface ChannelIdentityInput {
  channel: Channel;
  phone?: string;
  externalUserId?: string;
  externalSpaceId?: string;
}

function isMissingChannelIdentityTable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2021' &&
    typeof error.meta?.table === 'string' &&
    String(error.meta.table).includes('ChannelIdentity')
  );
}

function logMissingTable(event: string): void {
  logger.warn(
    {
      event,
      model: 'ChannelIdentity',
    },
    'ChannelIdentity table missing; Telegram identity mapping is temporarily disabled until migration is applied',
  );
}

export async function findIdentityByExternalUserId(
  channel: Channel,
  externalUserId: string,
): Promise<{ shopId: string } | null> {
  if (!externalUserId.trim()) {
    return null;
  }

  try {
    return await prisma.channelIdentity.findUnique({
      where: {
        channel_externalUserId: {
          channel,
          externalUserId: externalUserId.trim(),
        },
      },
      select: {
        shopId: true,
      },
    });
  } catch (error) {
    if (isMissingChannelIdentityTable(error)) {
      logMissingTable('channel_identity_lookup_skipped');
      return null;
    }

    throw error;
  }
}

export async function findIdentityByPhone(
  channel: Channel,
  phone: string,
): Promise<{ shopId: string } | null> {
  if (!phone.trim()) {
    return null;
  }

  try {
    return await prisma.channelIdentity.findUnique({
      where: {
        channel_phone: {
          channel,
          phone: phone.trim(),
        },
      },
      select: {
        shopId: true,
      },
    });
  } catch (error) {
    if (isMissingChannelIdentityTable(error)) {
      logMissingTable('channel_identity_lookup_skipped');
      return null;
    }

    throw error;
  }
}

export async function upsertChannelIdentity(shopId: string, input: ChannelIdentityInput): Promise<void> {
  const channel = input.channel;
  const phone = input.phone?.trim();
  const externalUserId = input.externalUserId?.trim();

  try {
    if (externalUserId) {
      await prisma.channelIdentity.upsert({
        where: {
          channel_externalUserId: {
            channel,
            externalUserId,
          },
        },
        update: {
          shopId,
          externalSpaceId: input.externalSpaceId?.trim() || null,
          phone: phone ?? null,
        },
        create: {
          shopId,
          channel,
          externalUserId,
          externalSpaceId: input.externalSpaceId?.trim() || null,
          phone: phone ?? null,
        },
      });

      return;
    }

    if (phone) {
      await prisma.channelIdentity.upsert({
        where: {
          channel_phone: {
            channel,
            phone,
          },
        },
        update: {
          shopId,
          externalSpaceId: input.externalSpaceId?.trim() || null,
        },
        create: {
          shopId,
          channel,
          phone,
          externalSpaceId: input.externalSpaceId?.trim() || null,
        },
      });
    }
  } catch (error) {
    if (isMissingChannelIdentityTable(error)) {
      logMissingTable('channel_identity_upsert_skipped');
      return;
    }

    throw error;
  }
}

export async function getShopByIdentity(input: ChannelIdentityInput): Promise<Shop | null> {
  let identity: { shopId: string } | null = null;

  if (input.externalUserId) {
    identity = await findIdentityByExternalUserId(input.channel, input.externalUserId);
  } else if (input.phone) {
    identity = await findIdentityByPhone(input.channel, input.phone);
  }

  if (!identity) {
    return null;
  }

  return prisma.shop.findUnique({
    where: { id: identity.shopId },
  });
}
