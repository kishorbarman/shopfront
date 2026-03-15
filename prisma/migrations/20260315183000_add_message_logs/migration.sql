-- CreateEnum
CREATE TYPE "public"."MessageProcessStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."MessageLog" (
    "id" TEXT NOT NULL,
    "twilioSid" TEXT,
    "shopId" TEXT,
    "phone" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "inboundText" TEXT NOT NULL,
    "parsedIntent" TEXT,
    "parsedSummary" TEXT,
    "updateApplied" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."MessageProcessStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "responseText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_twilioSid_key" ON "public"."MessageLog"("twilioSid");

-- CreateIndex
CREATE INDEX "MessageLog_shopId_createdAt_idx" ON "public"."MessageLog"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_phone_createdAt_idx" ON "public"."MessageLog"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_status_idx" ON "public"."MessageLog"("status");

-- AddForeignKey
ALTER TABLE "public"."MessageLog" ADD CONSTRAINT "MessageLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
