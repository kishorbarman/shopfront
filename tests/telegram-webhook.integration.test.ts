import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function applyEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || "development";
  process.env.PORT = process.env.PORT || "3000";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://shopfront:shopfront@localhost:5432/shopfront?schema=public";
  process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/12";
  process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "ACxxxxxxxx";
  process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "twilio-token";
  process.env.TWILIO_SMS_NUMBER = process.env.TWILIO_SMS_NUMBER || "+15550000001";
  process.env.TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "+15550000002";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "gemini-key";
  process.env.SENTRY_DSN = process.env.SENTRY_DSN || "https://public@sentry.io/1";
  process.env.BASE_URL = process.env.BASE_URL || "https://shopfront.page";
  process.env.ENABLE_TELEGRAM = "true";
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "telegram-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "telegram-secret";
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "shopfront_agent_bot";
  process.env.SKIP_TELEGRAM_VALIDATION = "true";
  process.env.SKIP_TWILIO_SEND = "true";
  process.env.SKIP_TWILIO_VALIDATION = "true";
  process.env.MOCK_LLM = "true";
}

applyEnv();

let app: { inject: (opts: unknown) => Promise<any>; close: () => Promise<void> };
let prisma: { $disconnect: () => Promise<void> };
let sharedRedis: { quit: () => Promise<unknown>; flushdb: () => Promise<"OK"> };

const originalFetch = globalThis.fetch;

test.before(async () => {
  for (const mod of ["../src/config", "../src/index"]) {
    const p = require.resolve(mod);
    delete require.cache[p];
  }

  const { buildServer } = require("../src/index") as {
    buildServer: () => Promise<{ inject: (opts: unknown) => Promise<any>; close: () => Promise<void> }>;
  };
  prisma = (require("../src/lib/prisma") as { prisma: { $disconnect: () => Promise<void> } }).prisma;
  sharedRedis = (require("../src/lib/redis") as {
    redis: { quit: () => Promise<unknown>; flushdb: () => Promise<"OK"> };
  }).redis;

  app = await buildServer();
});

test.beforeEach(async () => {
  await sharedRedis.flushdb();
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  await sharedRedis.quit();
  await prisma.$disconnect();
});

test("telegram webhook returns ignored for unsupported updates", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })) as typeof fetch;

  const response = await app.inject({
    method: "POST",
    url: "/api/webhook/telegram",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET,
    },
    payload: {
      update_id: 999111,
      inline_query: {
        id: "ignored",
      },
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { ok?: boolean; ignored?: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.ignored, true);
});

test("telegram duplicate /start burst sends only one outbound welcome", async () => {
  const outboundBodies: string[] = [];
  const outboundUrls: string[] = [];

  globalThis.fetch = (async (input, init) => {
    outboundUrls.push(String(input));
    if (typeof init?.body === "string") {
      outboundBodies.push(init.body);
    }

    if (String(input).includes("/deleteMessage")) {
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
  }) as typeof fetch;

  const headers = {
    "content-type": "application/json",
    "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET,
  };

  const first = await app.inject({
    method: "POST",
    url: "/api/webhook/telegram",
    headers,
    payload: {
      update_id: 100001,
      message: {
        message_id: 5001,
        date: Math.floor(Date.now() / 1000),
        text: "/start",
        from: { id: 8052664312 },
        chat: { id: 8052664312 },
      },
    },
  });

  const second = await app.inject({
    method: "POST",
    url: "/api/webhook/telegram",
    headers,
    payload: {
      update_id: 100002,
      message: {
        message_id: 5002,
        date: Math.floor(Date.now() / 1000),
        text: "/start",
        from: { id: 8052664312 },
        chat: { id: 8052664312 },
      },
    },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);

  const secondBody = second.json() as { duplicate?: boolean };
  assert.equal(secondBody.duplicate, true);

  const welcomeCount = outboundBodies.filter((body) =>
    body.includes("Welcome to Shopfront on Telegram!"),
  ).length;
  assert.equal(welcomeCount, 1);

  const deleteCount = outboundUrls.filter((url) => url.includes("/deleteMessage")).length;
  assert.equal(deleteCount, 1);
});
