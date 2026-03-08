# Shopfront Progress Log

## Project Timeline

### Step 1 - Project Scaffolding (Completed)

Implemented:
- Node.js + TypeScript project with strict config
- Fastify server scaffold with `.env` loading
- Health route `GET /health`
- Initial folder structure for routes/services/models/agent/templates
- ESLint + Prettier configuration
- Docker Compose for PostgreSQL 16 + Redis 7
- `.env.example` template
- Base README setup instructions
- Git repository initialization

Verification completed:
- `npm run dev` started server successfully
- `curl http://localhost:3000/health` returned JSON with status and timestamp
- `npm run lint` passed
- `npm run build` passed

### Step 2 - Prisma Schema + Migration + Seed (Completed)

Implemented:
- Full Prisma schema for:
  - `Shop`
  - `Service`
  - `Hour`
  - `Notice`
- Enums:
  - `ShopStatus`
  - `NoticeType`
- `prisma/seed.ts` for sample tenant: Tony's Barbershop
- Prisma singleton client in `src/lib/prisma.ts`
- Package scripts:
  - `prisma:migrate`
  - `prisma:seed`

Data seeded:
- Shop: Tony's Barbershop (`tonys-barbershop`, `ACTIVE`)
- Services: Haircut 25, Fade 30, Beard Trim 15, Hot Towel Shave 20, Kids Cut 18
- Hours: Mon-Sat 09:00-19:00, Sun closed
- Address: 742 Evergreen Terrace, Springfield

Verification completed:
- Migration applied successfully
- Seed script executed successfully
- SQL checks confirmed shop/services/hours rows
- `npm run lint` passed
- `npm run build` passed

Notes:
- Prisma aligned to v6 for compatibility with current schema style in this guide.

### Step 3 - Twilio Messaging Layer (Completed)

Implemented:
- Webhook endpoints:
  - `POST /api/webhook/sms`
  - `POST /api/webhook/whatsapp`
- Twilio signature validation using `twilio.validateRequest`
- Unified inbound normalization to `InboundMessage`
  - Channel-aware parsing
  - `whatsapp:` prefix stripping
  - Media URL extraction from Twilio payload (`NumMedia`, `MediaUrlN`)
- Outbound messaging service `sendMessage(msg)`:
  - Sends via Twilio for SMS/WhatsApp
  - Applies `whatsapp:` prefix for WhatsApp transport
  - Returns Twilio Message SID
  - Logs outbound metadata
- Placeholder message pipeline:
  - Logs inbound message
  - Calls `processMessage(message)`
  - Echoes response: `Got your message: {body}`
  - Returns empty TwiML response (`<Response/>`)
- Local test script:
  - `scripts/test-webhook.ts`
  - `npm run test:webhook`
- README additions:
  - Local webhook test instructions
  - ngrok setup for real Twilio callbacks

Environment/test flags added:
- `SKIP_TWILIO_VALIDATION`
- `SKIP_TWILIO_SEND`

Verification completed:
- Simulated SMS webhook test returned `200` + TwiML response
- WhatsApp webhook accepted payload and normalized numbers/media correctly
- Unsigned webhook rejected with `403` when validation enabled
- `sendMessage()` validated for both SMS and WhatsApp channels (test mode)
- `npm run lint` passed
- `npm run build` passed

### Step 4 - Redis Conversation State Management (Completed)

Implemented:
- Redis singleton client in `src/lib/redis.ts`
  - Uses `REDIS_URL` (default `redis://localhost:6379`)
  - Handles connection errors with graceful logging
- Conversation state service in `src/services/conversationState.ts`
  - `getState(phone)`
  - `setState(phone, state)` with 24h TTL
  - `clearState(phone)`
- Message history support:
  - `addMessage(phone, role, content)`
  - `getHistory(phone)`
  - Stores only last 10 messages
  - 7-day TTL
- Rate limiting:
  - `checkRateLimit(phone)`
  - Max 20 messages/hour using Redis `INCR` + expiry
- Updated placeholder `processMessage(message)` pipeline:
  - Checks rate limit and returns slow-down response when exceeded
  - Loads or creates conversation state
  - Adds inbound message to history
  - Logs current state
  - Echoes with mode: `Got your message ({mode}): {body}`
  - Adds agent response to history
- Unit tests in `tests/conversationState.test.ts` using dedicated test Redis DB

Verification completed:
- State persists and is retrievable for same phone number
- Message history trims correctly to 10
- Rate limiter blocks after 20 messages/hour
- Unit test suite passed (`4/4`)
- `npm run lint` passed
- `npm run build` passed

---

## Current Status

Completed through Step 4 of the implementation guide.

Next target:
- Step 5: Onboarding flow state machine and parser integration.
