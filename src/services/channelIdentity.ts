import type { ChannelIdentity } from '@prisma/client';

import { prisma } from '../lib/prisma';
import type { Channel } from '../models/types';

type CreateChannelIdentityInput = {
  shopId: string;
  channel: Channel;
  phone?: string;
  externalUserId?: string;
  externalSpaceId?: string;
};

export async function createChannelIdentity(input: CreateChannelIdentityInput): Promise<ChannelIdentity> {
  return prisma.channelIdentity.create({
    data: {
      shopId: input.shopId,
      channel: input.channel,
      phone: input.phone ?? null,
      externalUserId: input.externalUserId ?? null,
      externalSpaceId: input.externalSpaceId ?? null,
    },
  });
}

export async function findChannelIdentityByPhone(channel: Channel, phone: string): Promise<ChannelIdentity | null> {
  return prisma.channelIdentity.findFirst({
    where: {
      channel,
      phone,
    },
  });
}

export async function findChannelIdentityByExternalUserId(
  channel: Channel,
  externalUserId: string,
): Promise<ChannelIdentity | null> {
  return prisma.channelIdentity.findFirst({
    where: {
      channel,
      externalUserId,
    },
  });
}

export async function findChannelIdentityForShop(shopId: string, channel: Channel): Promise<ChannelIdentity | null> {
  return prisma.channelIdentity.findFirst({
    where: {
      shopId,
      channel,
    },
  });
}
