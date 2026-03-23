-- CreateTable
CREATE TABLE "ChannelIdentity" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "phone" TEXT,
    "externalUserId" TEXT,
    "externalSpaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelIdentity_channel_phone_idx" ON "ChannelIdentity"("channel", "phone");

-- CreateIndex
CREATE INDEX "ChannelIdentity_channel_externalUserId_idx" ON "ChannelIdentity"("channel", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_channel_phone_key" ON "ChannelIdentity"("channel", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_channel_externalUserId_key" ON "ChannelIdentity"("channel", "externalUserId");

-- AddForeignKey
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
