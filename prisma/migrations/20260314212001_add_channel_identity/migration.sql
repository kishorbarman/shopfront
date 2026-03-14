-- CreateTable
CREATE TABLE "public"."ChannelIdentity" (
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
CREATE INDEX "ChannelIdentity_channel_phone_idx" ON "public"."ChannelIdentity"("channel", "phone");

-- CreateIndex
CREATE INDEX "ChannelIdentity_channel_externalUserId_idx" ON "public"."ChannelIdentity"("channel", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_channel_phone_key" ON "public"."ChannelIdentity"("channel", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_channel_externalUserId_key" ON "public"."ChannelIdentity"("channel", "externalUserId");

-- AddForeignKey
ALTER TABLE "public"."ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
