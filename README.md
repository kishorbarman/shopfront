# Shopfront

Shopfront is a text-to-website platform for small businesses.
Owners update their public business page by sending SMS or WhatsApp messages to an AI agent.

## Tech Stack

- Node.js + TypeScript (strict mode)
- Fastify
- PostgreSQL + Prisma ORM
- Redis + ioredis
- Anthropic Claude SDK
- Twilio (SMS + WhatsApp)
- ESLint + Prettier

## Project Structure

```text
src/
  index.ts              Fastify entry point, loads .env
  routes/
    webhook.ts          Twilio inbound message webhook handlers
    health.ts           GET /health endpoint
  services/
    messaging.ts        Twilio SMS + WhatsApp send abstraction
    agent.ts            Agent placeholder (echo response)
    siteBuilder.ts      Site build placeholder
  models/
    types.ts            Shared TypeScript types/interfaces
  agent/
    prompts.ts          Prompt template placeholders
    intents.ts          Intent schema placeholders
  templates/
    base.html           Base HTML template
prisma/
  schema.prisma         Database schema
  seed.ts               Seed data script
docker-compose.yml      PostgreSQL 16 + Redis 7
.env.example            Environment variable template
scripts/
  test-webhook.ts       Simulated Twilio SMS webhook test
```

## Prerequisites

- Node.js 20+
- npm 10+
- Docker + Docker Compose

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Start local infrastructure (PostgreSQL + Redis):

```bash
docker compose up -d
```

4. Run migrations and seed:

```bash
npm run prisma:migrate
npm run prisma:seed
```

5. Start the development server:

```bash
npm run dev
```

The API runs on `http://localhost:3000` by default.

## Available Scripts

- `npm run dev` - Run Fastify in watch mode via `tsx`
- `npm run build` - Compile TypeScript to `dist/`
- `npm run start` - Run compiled server from `dist/`
- `npm run lint` - Lint TypeScript files with ESLint
- `npm run test` - Placeholder test script
- `npm run prisma:migrate` - Run Prisma migrations
- `npm run prisma:seed` - Seed database
- `npm run test:webhook` - Send a simulated Twilio SMS webhook

## Health Check

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2026-03-08T00:00:00.000Z"
}
```

## Webhook Testing (Local)

Use test mode for local webhook simulation:

```bash
SKIP_TWILIO_VALIDATION=true SKIP_TWILIO_SEND=true npm run dev
```

In another terminal:

```bash
npm run test:webhook
```

## Twilio + ngrok Setup

1. Start your server:

```bash
npm run dev
```

2. Start ngrok:

```bash
ngrok http 3000
```

3. In Twilio Console, configure webhook URLs:

- SMS webhook: `https://<your-ngrok-domain>/api/webhook/sms`
- WhatsApp webhook: `https://<your-ngrok-domain>/api/webhook/whatsapp`

4. Set your real Twilio credentials/numbers in `.env` and keep:

```bash
SKIP_TWILIO_VALIDATION=false
SKIP_TWILIO_SEND=false
```

## Notes

Current message handling is intentionally minimal for Step 3:
- Inbound messages are normalized into a unified `InboundMessage`
- Placeholder agent replies with `Got your message: {body}`
- Outbound response is sent on the same channel

## Photo Handling (Step 8)

- Incoming MMS/WhatsApp media is downloaded using Twilio basic auth (`TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`).
- Accepted formats: JPEG, PNG, WebP.
- Maximum file size: 10MB.
- Images are processed with `sharp`:
  - Main image resized to max width 1200px
  - Thumbnail resized to max width 400px
  - Output format WebP
  - EXIF stripped
- Stored files live under `public/uploads/{shopId}/` and are served from `/public/...`.
- `BASE_URL` controls absolute URL generation (default example: `http://localhost:3000`).

Photo intent behavior:
- Text like "banner", "main photo", or "profile" + media updates `shop.photoUrl`.
- Text like "gallery" + media adds photos to gallery manifest (`public/uploads/{shopId}/gallery.json`).
- Media without clear context asks: banner or gallery.
