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
    webhook.ts          Twilio webhook route skeleton
    health.ts           GET /health endpoint
  services/
    messaging.ts        Twilio messaging abstraction (stub)
    agent.ts            Agent pipeline placeholder
    siteBuilder.ts      Site build placeholder
  models/
    types.ts            Shared TypeScript types
  agent/
    prompts.ts          Prompt template placeholders
    intents.ts          Intent schema placeholders
  templates/
    base.html           Base HTML template
prisma/
  schema.prisma         Prisma schema placeholder
docker-compose.yml      PostgreSQL 16 + Redis 7
.env.example            Environment variable template
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

4. Start the development server:

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

## Notes

This repository currently contains project scaffolding only.
Business logic will be implemented step by step from the implementation guide.
