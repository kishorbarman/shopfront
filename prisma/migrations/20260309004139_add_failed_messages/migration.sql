-- CreateTable
CREATE TABLE "public"."FailedMessage" (
    "id" TEXT NOT NULL,
    "twilioSid" TEXT,
    "phone" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorStack" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "FailedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FailedMessage_phone_idx" ON "public"."FailedMessage"("phone");

-- CreateIndex
CREATE INDEX "FailedMessage_createdAt_idx" ON "public"."FailedMessage"("createdAt");

-- CreateIndex
CREATE INDEX "FailedMessage_processedAt_idx" ON "public"."FailedMessage"("processedAt");
