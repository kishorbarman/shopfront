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

### Step 5 - Onboarding Flow (Completed)

Implemented:
- Full onboarding state machine in `src/agent/onboarding.ts`:
  - Step 1: Welcome + business name capture
  - Step 2: Category capture
  - Step 3: Services capture
  - Step 4: Services confirmation/correction
  - Step 5: Hours capture
  - Step 6: Address capture
  - Step 7: Completion + persistence + activation
- LLM parser layer in `src/agent/parsers.ts`:
  - `parseBusinessName`
  - `parseCategory`
  - `parseServices`
  - `parseHours`
  - Uses Gemini Flash when API key is available
  - Includes deterministic fallback parsing for local/test mode
- Agent routing update in `src/services/agent.ts`:
  - Unknown phone numbers enter onboarding flow
  - Known shops remain active mode
  - State and history remain integrated with Redis
- Onboarding completion persists data to PostgreSQL:
  - Creates `Shop`
  - Creates `Service[]`
  - Creates `Hour[]`
  - Sets shop status to `ACTIVE`
- Slug generation logic:
  - lowercased + hyphenated
  - deduplicated
  - unique suffixing (`-2`, `-3`, etc.) when needed

Parser hardening update:
- Improved messy service parsing fallback to handle number words:
  - "haircut twenty five"
  - "lineup ten and shave twenty"
  - "beard trim for fifteen"
- Hours parser verified for:
  - "mon thru fri 9-6"

Tests added:
- `tests/onboarding.integration.test.ts` (full onboarding happy path)
- `tests/parsers.test.ts` (messy parser inputs)

Verification completed:
- Full onboarding from new number creates shop + services + hours
- Slug generation works and uniqueness verified
- Conversation state progression tracked step-by-step
- Parsers handle messy hours and services examples
- Integration + unit tests pass (`8/8`)
- `npm run lint` passed
- `npm run build` passed

### Step 6 - Intent Classification Pipeline (Completed)

Implemented:
- Intent taxonomy and result schema in `src/agent/intents.ts`
- Intent classifier in `src/agent/classifier.ts`
  - Gemini Flash classification path
  - Heuristic fallback path for local/test mode
  - Confidence threshold handling (`< 0.7` => clarification)
  - Media/photo-aware classification
  - Shop-context-aware confidence improvement using known service names
- Intent router in `src/agent/router.ts`
  - Stub handlers for all intent categories
  - Clarification-first return when `needsClarification=true`
  - Special responses for `greeting`, `help`, `unknown`
- `processMessage()` integration for existing shops in `src/services/agent.ts`
  - Known phone -> load history/state -> classify -> route -> reply
  - New/unknown phone onboarding behavior preserved

Classifier hardening updates:
- Added support for typo/slang and natural phrasing:
  - `chg fade to 35 pls` => `update_service`
  - `take off fade` => `remove_service`
  - `remove that sign now` => `remove_notice`
- Improved query vs update-hours intent precedence:
  - `Show my hours` => `query`
- Reduced flaky test behavior by using unique phone numbers in integration tests

Tests added/updated:
- `tests/classifier.test.ts`
  - Covers all intent categories
  - At least 5 example messages per intent
  - Includes ambiguity/clarification and context-confidence assertions
- `tests/router.test.ts`
  - Verifies intent-to-stub dispatch and clarification override behavior
- `tests/agent-existing-shop.integration.test.ts`
  - End-to-end existing-shop path: classify + route through `processMessage`

Verification completed:
- Classifier identifies all intents on sample sets
- Confidence scoring triggers clarification for ambiguous messages
- Router dispatches correctly for all stub intents
- Shop context improves classification confidence
- Per-intent examples meet >=5 coverage requirement
- Full test suite passes (`15/15`)
- `npm run lint` passed
- `npm run build` passed

---

## Current Status

Completed through Step 6 of the implementation guide.

Next target:
- Step 7: Entity extraction + mutation handlers with confirmation flow.

### Step 7 - Entity Extraction + Update Handlers (In Progress)

Implemented:
- Added mutation extraction module in `src/agent/extractors.ts`
  - Intent-specific extraction for:
    - `add_service`
    - `update_service`
    - `remove_service`
    - `update_hours`
    - `temp_closure`
    - `update_contact`
    - `add_notice`
    - `remove_notice`
    - `update_photo`
  - Added confirmation message builder per mutation intent
  - Added query formatter for current services/hours/notices
- Added DB mutation service in `src/services/shopUpdater.ts`
  - `addService`, `updateService`, `removeService` (soft delete)
  - `updateHours`
  - `addNotice`, `removeNotice`
  - `updateContact`
  - shop `updatedAt` touch behavior after mutations
- Updated `src/services/agent.ts`
  - Full pending-action confirmation flow:
    - confirm => execute mutation
    - cancel => abort + clear pending action
    - unrelated next message => clear pending action + reclassify
  - Query intent now reads current data and returns formatted response

Hardening/Fixes completed:
- Classifier precedence fix in `src/agent/classifier.ts`:
  - query phrases like "Show notices" are classified as `query` (not `add_notice`)
- Improved messy service extraction in `src/agent/extractors.ts`:
  - Removed unsafe fallback to first service
  - Improved phrase stripping for update-service parsing (e.g. "Change hot towel to 22")
- Updated integration fixture in `tests/agent-existing-shop.integration.test.ts`
  - Added `Hot Towel Shave` seed service for fuzzy-match coverage

Tests added/updated:
- Added `tests/extractors.test.ts` for entity extraction coverage
- Updated `tests/agent-existing-shop.integration.test.ts` for:
  - confirm -> execute
  - cancel flow
  - unrelated-message redirect
  - query responses (services/hours/notices)
  - fuzzy service matching

Latest verification run:
- `npm test` => pass (`28/28`)
- `npm run lint` => pass
- `npm run build` => pass

Verification status mapping:
- Entity extraction from natural language => verified (unit tests)
- Confirmation flow (confirm/cancel/redirect) => verified (integration tests)
- Query responses accurate for current data => verified (integration tests)
- Fuzzy matching for typos/abbreviations => verified (unit + integration tests)
- DB mutation verification => partially covered in integration tests; full per-intent mutation integration expansion pending in next pass

### Step 8 - Photo Handling (Completed)

Implemented:
- Added `src/services/mediaStorage.ts`:
  - Twilio-authenticated media download (`downloadMedia`)
  - Image validation (JPEG/PNG/WebP, max 10MB)
  - Image processing with Sharp:
    - max width 1200px for main image
    - max width 400px thumbnail
    - WebP conversion
    - EXIF stripping
  - Local MVP storage under `public/uploads/{shopId}/`
  - Gallery manifest support (`gallery.json`)
- Updated `src/services/agent.ts` photo flow:
  - Media + banner/profile language => immediate banner update (`shop.photoUrl`)
  - Media + gallery language => gallery append
  - Media-only/no context => asks banner vs gallery and persists pending action
  - Follow-up response applies choice
- Updated `src/index.ts` to serve static files under `/public/*`
- Updated `.env.example` with `BASE_URL`
- Added README section documenting photo pipeline behavior

Tests added/updated:
- `tests/mediaStorage.test.ts`
  - Processing output checks (WebP, size constraints, EXIF removed)
  - File-based media download validation path
- `tests/agent-existing-shop.integration.test.ts`
  - Banner photo update integration test
  - No-context photo -> clarification -> gallery flow integration test

Verification completed:
- `npm run lint` passed
- `npm run build` passed
- `npm test` passed
- Photo pipeline verified for download/transform/store and banner/gallery intent handling

### Step 9 - HTML Template Engine + Public Routes (Completed)

Implemented:
- Added `src/templates/generator.ts`:
  - `generateShopPage(shop)` returns full HTML string
  - Sections:
    - Header (name/category/banner or gradient fallback)
    - Notices with severity styling
    - Services/Menu list with prices
    - Hours table with current-day highlight and closed state
    - Location with Google Maps link
    - Contact with tap-to-call and tap-to-text
    - Footer branding
  - Mobile-first responsive CSS, no JS, system fonts only
  - Category accents:
    - Barber (green/gold)
    - Restaurant/Food (warm red/brown)
    - Salon (purple/pink)
    - General (blue/slate)
  - Two visual template modes:
    - `services` (default)
    - `menu` (restaurant/food-like categories)
  - SEO/Social:
    - title, meta description
    - Open Graph tags
    - Schema.org LocalBusiness JSON-LD
- Added `src/routes/pages.ts`:
  - `GET /s/:slug` (live generated HTML, cache header `public, max-age=300`)
  - `GET /preview/:shopId` (no-store preview)
- Registered pages routes in `src/index.ts`
- Added `tests/page-generator.test.ts`:
  - Validates required sections + SEO/meta/JSON-LD presence
  - Validates menu variant rendering for restaurant
  - Generates visual fixtures for manual review:
    - `tests/visual-output/tonys-barbershop.html`
    - `tests/visual-output/sunset-tacos.html`
- Updated test runner to avoid Redis cross-test flakiness:
  - `package.json` test script uses `--test-concurrency=1`

Verification completed (March 8, 2026):
- Route verification:
  - `GET /s/tonys-barbershop` returns `200` HTML with cache header and complete page
- Performance:
  - Lighthouse mobile performance score: `100`
  - FCP: `0.6s`, LCP: `0.8s`, TBT: `0ms`, CLS: `0`
- Layout checks:
  - Captured screenshots at 320px and 1280px (`/tmp/tonys-mobile-320.png`, `/tmp/tonys-desktop-1280.png`)
  - Visual layout confirmed readable and responsive
- Section rendering:
  - Services with prices, hours, notices, location, contact all present in returned HTML
- Schema validation:
  - JSON-LD extracted and parsed successfully as valid JSON (`@type: LocalBusiness`)
- Full suite status:
  - `npm run lint` passed
  - `npm run build` passed
  - `npm test` passed (`35/35`)

### Step 10 - Site Rebuild Pipeline + Full Text-to-Website Loop (Completed)

Implemented:
- Added `src/services/siteBuilder.ts`:
  - `rebuildSite(shopId)` loads shop + services + hours + active notices
  - Generates HTML via `generateShopPage`
  - Writes prebuilt output to `public/sites/{slug}/index.html`
  - Logs rebuild completion for traceability
- Added rebuild triggers after successful mutations:
  - `src/services/shopUpdater.ts` now triggers rebuild after:
    - add/update/remove service
    - update hours
    - add/remove notice
    - update contact (address changes trigger rebuild)
- Added rebuild trigger on onboarding completion:
  - `src/agent/onboarding.ts` calls `rebuildSite(shopId)` once the first shop data is created
- Added rebuild trigger for photo updates:
  - `src/services/agent.ts` triggers rebuild after banner photo changes and gallery updates
- Updated static serving route behavior in `src/routes/pages.ts`:
  - `GET /s/:slug` now checks prebuilt file first
  - If missing, rebuilds and serves
  - Adds cache headers: `Cache-Control: public, max-age=300`
  - Adds `ETag` and `Last-Modified` based on `shop.updatedAt`
- Updated `src/index.ts` to export `buildServer()` for script-driven end-to-end tests
- Added end-to-end loop script `scripts/test-full-loop.ts`:
  - Simulates onboarding via webhook
  - Verifies generated page availability
  - Simulates service price update and verifies HTML reflects change
  - Simulates temporary closure notice and verifies HTML reflects change
  - Simulates add-service flow and verifies HTML reflects change
  - Verifies cache headers on `/s/:slug`
  - Asserts rebuild cycles complete in under 2 seconds
  - Cleans up DB + generated files after run
- Added npm script:
  - `test:full-loop` in `package.json`
- Updated `.gitignore`:
  - Added `public/sites` and `public/uploads` as runtime/generated artifacts

Verification completed (March 8, 2026):
- `npm run lint` passed
- `npm run build` passed
- `npm test` passed
- `npm run test:full-loop` passed (`Full loop test passed`)
- Confirmed no lingering E2E runner processes after completion

Step 10 verification mapping:
- Sending `add lineup for $10` via SMS results in service appearing on live page => verified
- Pre-built HTML is served correctly with cache headers => verified
- Full loop E2E test passes => verified
- Page rebuilds complete in under 2 seconds => verified

### Step 11 - Deployment & Infrastructure (Completed In Repo; External Validation Partially Pending)

Implemented:
- Added environment validation and fail-fast config loader:
  - `src/config.ts`
  - Validates required env vars: `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, Twilio vars, `GEMINI_API_KEY`, `BASE_URL`
- Production server hardening in `src/index.ts`:
  - Fastify logger (pino)
  - CORS (`@fastify/cors`)
  - Helmet (`@fastify/helmet`)
  - `trustProxy: true`
  - Graceful shutdown (Fastify + Redis + Prisma)
  - Request counter hook
  - Registered `/metrics`
- Added metrics endpoint:
  - `src/routes/metrics.ts`
  - Returns status, timestamp, uptime, requestCount, activeShops
- Updated runtime modules to use centralized config:
  - `src/lib/prisma.ts`
  - `src/lib/redis.ts`
  - `src/routes/webhook.ts`
  - `src/services/messaging.ts`
  - `src/services/mediaStorage.ts`
  - `src/templates/generator.ts`
  - `src/agent/classifier.ts`, `src/agent/parsers.ts`, `src/agent/extractors.ts`
- Added deployment artifacts:
  - `Dockerfile` (multi-stage, node:20-slim, non-root, exposes 3000)
  - `.dockerignore`
  - `docker-compose.prod.yml` (app + postgres16 + redis7 + persistent volumes)
  - `railway.json`
  - `.github/workflows/deploy.yml` (lint/test/build + deploy job)
  - `docs/DEPLOY.md` (Railway step-by-step deployment)
- Updated env/docs:
  - `.env.example` uses `BASE_URL`
  - README and progress docs updated for `BASE_URL`

Verification completed (March 8, 2026):
- Local quality checks:
  - `npm run lint` passed
  - `npm run build` passed
  - `MOCK_LLM=true npm test` passed (`35/35`)
- Env validation behavior:
  - Invalid `NODE_ENV=staging` fails fast with clear error
  - Missing envs fail fast with clear, enumerated errors
- Docker verification:
  - Docker image build succeeded: `docker build -t shopfront:step11 .`
  - Production stack starts successfully via `docker-compose.prod.yml`
  - `/health` returns `200`
  - `/metrics` returns `200` after running `prisma migrate deploy` inside container

Remaining external verification (requires user-managed infra/accounts):
- CI/CD runtime execution on GitHub push to `main`
- Production URL health check (`https://shopfront-production-2dc5.up.railway.app/health`)
- Twilio production webhook wiring and live message flow verification

### Step 12 - Error Handling, Logging & Monitoring (Completed)

Implemented:
- Added custom error classes:
  - `src/lib/errors.ts`
  - `AgentParseError`, `AgentConfidenceError`, `DatabaseError`, `MessagingError`, `RateLimitError`, `ValidationError`
- Added structured logging with `pino`:
  - `src/lib/logger.ts`
  - Instrumented key events:
    - `message_received`
    - `intent_classified`
    - `shop_updated`
    - `message_sent`
    - `error`
- Added Sentry integration:
  - `src/lib/observability.ts`
  - Initializes Sentry at server startup in `src/index.ts`
  - Reports pipeline and webhook errors with tags/context (`shopId`, `intent`, `channel`, phone, Twilio SID)
- Added graceful fallback messaging in webhook processing:
  - `src/routes/webhook.ts`
  - LLM/parse/db/rate-limit/messaging/unknown errors now return friendly responses (no silent failures)
- Added dead letter queue support:
  - Prisma model: `FailedMessage` in `prisma/schema.prisma`
  - Migration: `prisma/migrations/20260309004139_add_failed_messages/`
  - Queue service: `src/services/failedMessageQueue.ts`
  - Webhook retries processing up to 3 times, then stores failed payload/error in DB
- Added failed message replay script:
  - `scripts/replay-failed.ts`
  - NPM script: `replay:failed`
- Updated environment config:
  - Added `SENTRY_DSN` to `.env.example`
  - `src/config.ts` validates `SENTRY_DSN` in production (fail-fast)
- Additional hardening and instrumentation updates:
  - `src/services/agent.ts` error context logging/reporting + propagated typed errors
  - `src/services/messaging.ts` wraps send failures as `MessagingError`
  - `src/services/shopUpdater.ts` wraps validation/DB failures and emits mutation logs
  - `src/agent/classifier.ts`, `src/agent/parsers.ts`, `src/agent/extractors.ts` switched parser/extractor error logging to structured logger
  - `src/lib/redis.ts` logs Redis connection errors via structured logger

Verification completed (March 9, 2026):
- `npx prisma migrate dev --name add_failed_messages` passed
- `npx prisma generate` passed
- `npm run lint` passed
- `npm run build` passed
- `npm run test` passed (`36/36`)
- Added and passed DLQ unit test:
  - `tests/failedMessageQueue.test.ts`
- Confirmed production config fails fast without `SENTRY_DSN`:
  - one-off `loadConfig` check returned `sentry_validation_ok`

### Step 13 - Marketing Website + Twilio Compliance Pages (Completed)

Implemented:
- Created standalone marketing site in separate subfolder:
  - `website/`
  - Designed as static, Firebase-ready, and extensible
- Added main product landing page:
  - `website/index.html`
  - Modern visual design, gradient/ambient background, responsive sections, CTA, support positioning
- Added shared styling and interactivity:
  - `website/styles.css`
  - `website/script.js`
  - Reveal animations, counters, CTA "Coming soon" toast
  - Header hide-on-scroll-down / show-on-scroll-up behavior
- Added and iterated branded logo assets:
  - `website/assets/shopfront-logo.svg`
  - `website/assets/shopfront-icon.svg`
  - Updated logo sizing and tagline text to improve clarity on mobile/desktop
- Added legal/support pages:
  - `website/privacy.html`
  - `website/terms.html`
  - `website/contact.html`
- Updated navigation/footer links:
  - Added Privacy, Terms, and Contact links from main page

Twilio compliance-focused legal updates:
- Privacy Policy includes:
  - Data collected (phone number + message content)
  - Purpose-limited usage for website updates
  - No retention of message content after processing
  - No third-party marketing/promotional sharing
  - Messaging control instructions (`STOP`, `START`, `HELP`)
  - Children’s privacy clause
  - Global availability statement
  - Contact email: `contact@shopfront.page`
  - Effective date: March 1, 2026
- Terms & Conditions includes:
  - Program name and program description
  - Message frequency disclosure
  - Message/data rates disclosure
  - Support contact info
  - Bold opt-out/help instructions (`STOP`, `HELP`, `START`)
  - Carrier liability statement
  - Effective date: March 1, 2026
- Contact page updated with support email:
  - `contact@shopfront.page`

Firebase hosting and deployment:
- Added Firebase config in site folder:
  - `website/firebase.json`
- Added site-specific README:
  - `website/README.md`
- Deployed to Firebase project `shopfront-page`
- Live URL:
  - `https://shopfront-page.web.app`

Additional helper tooling:
- Added local personal-number webhook simulation script:
  - `scripts/test-personal-phone.ts`
  - Uses `+14156871788` default `from` for simulation
- Added local website dev server script in `package.json`:
  - `website:dev`

Verification completed (March 9, 2026):
- Local server verification for website pages (`index`, `privacy`, `terms`, `contact`)
- CTA interaction verified (shows "Coming soon")
- Mobile responsiveness improved for readability and tap targets
- Header scroll behavior verified and tuned for slow + fast scroll
- Firebase deploy completed successfully and pages verified live

### Step 14 - WhatsApp Production Validation + Publish Fixes (Completed)

Implemented:
- Fixed production site rebuild path to support read-only container filesystems:
  - `src/config.ts`
  - `src/services/siteBuilder.ts`
  - Added configurable `SITE_OUTPUT_DIR` (production default uses writable runtime path)
- Hardened onboarding completion to be idempotent by phone number:
  - `src/agent/onboarding.ts`
  - Existing shop for a phone is updated instead of duplicate create
  - Services/hours are replaced on completion to keep state consistent
- Updated onboarding live-page message format to include `/s/{slug}` path
  - `src/agent/onboarding.ts`

Production verification completed (March 14-15, 2026):
- Railway health endpoint is healthy:
  - `GET /health` => `200`
- Twilio webhook security is enforced:
  - invalid signature => `403 Invalid Twilio signature`
- Signed WhatsApp webhook processing succeeds:
  - inbound webhook => `200` TwiML response
  - outbound Twilio message SID logged
- Real WhatsApp onboarding messages were processed through onboarding steps
- Live generated page is accessible in production:
  - `https://shopfront-production-2dc5.up.railway.app/s/your-shop-2` => `200` with full HTML

Notes:
- For Railway production, `SITE_OUTPUT_DIR` should be set to a writable path (recommended: `/tmp/sites`).

## Telegram Channel Expansion (New)

### Phase 1 - Telegram Domain Model & Config (Completed)

Implemented:
- Extended channel model to include Telegram in `src/models/types.ts`.
- Extended inbound message model with external identity fields:
  - `externalUserId`
  - `externalSpaceId`
  - `rawPayload`
- Added Telegram environment variables in `.env.example`:
  - `ENABLE_TELEGRAM`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_WEBHOOK_SECRET`
  - `TELEGRAM_BOT_USERNAME`
  - `SKIP_TELEGRAM_VALIDATION`
- Added fail-fast config validation in `src/config.ts` for Telegram-enabled deployments.

Verification completed:
- `npm run build` passed.
- `tests/config-telegram.test.ts` passed:
  - Telegram vars not required when disabled.
  - Telegram vars required when enabled.
  - Validation skip behavior works as expected.

### Phase 2 - Telegram Inbound Webhook (Completed)

Implemented:
- Added Telegram auth/parser utility in `src/lib/telegramAuth.ts`:
  - request secret validation
  - payload normalization
  - idempotency key generation
- Added Telegram webhook endpoint in `src/routes/webhook.ts`:
  - `POST /api/webhook/telegram`
- Added request validation using header:
  - `X-Telegram-Bot-Api-Secret-Token`
- Added deduplication guard via Redis key per `update_id`.
- Normalized Telegram events into unified `InboundMessage` and routed through existing `processMessage()` pipeline.

Verification completed:
- `tests/telegramAuth.test.ts` passed.
- Production manual check passed:
  - webhook receives Telegram requests (`/api/webhook/telegram`)
  - `message_received` logs show `channel=telegram`
  - request validation and idempotency behavior confirmed.

### Phase 3 - Telegram Outbound Sender (Completed)

Implemented:
- Added Telegram sender service in `src/services/telegramMessaging.ts`:
  - `sendMessage` path (`sendMessage` Telegram API)
  - media path (`sendPhoto` when `mediaUrl` is provided)
  - robust API error handling and `MessagingError` wrapping
  - structured outbound logging with channel/recipient/body metadata
- Refactored `src/services/messaging.ts` routing:
  - `telegram` -> Telegram sender
  - `sms`/`whatsapp` -> existing Twilio path unchanged
- Updated Telegram webhook flow in `src/routes/webhook.ts` to send real outbound replies via `sendMessage()`.

Verification completed:
- `npm run build` passed.
- `tests/telegramMessaging.test.ts` passed:
  - text send path
  - photo send path
  - non-2xx error handling
  - channel routing through `sendMessage()`
- Combined Telegram test suite passed:
  - `tests/config-telegram.test.ts`
  - `tests/telegramAuth.test.ts`
  - `tests/telegramMessaging.test.ts`

Current Telegram status:
- Inbound webhook: working in production.
- Outbound Telegram responses: implemented and enabled.
- End-to-end Telegram conversation path is now active (subject to bot webhook/env configuration).

### Phase 4 - Telegram Identity Mapping & Account Linking (Completed)

What was implemented:
- Added `ChannelIdentity` data model in Prisma to map external messaging identities to shops.
  - New relation on `Shop.identities`
  - Unique keys for `(channel, phone)` and `(channel, externalUserId)`
- Added migration SQL for `ChannelIdentity` table and indexes.
- Added `src/services/channelIdentity.ts` helper service:
  - `findIdentityByExternalUserId`
  - `findIdentityByPhone`
  - `upsertChannelIdentity`
  - `getShopByIdentity`
- Added Telegram linking service `src/services/telegramLinking.ts`:
  - One-time code generation and consumption (`createTelegramLinkCode`, `consumeTelegramLinkCode`)
  - Telegram command parsing (`/start`, `/help`, `/link CODE`)
  - SMS/WhatsApp trigger phrase detection for code generation (`link telegram`)
- Updated agent pipeline (`src/services/agent.ts`):
  - Resolves Telegram shops via identity mapping first
  - Adds phone-channel trigger to generate one-time Telegram link code for existing shops
  - Persists Telegram identity mapping after successful onboarding/processing when `shopId` is known
- Updated Telegram webhook (`src/routes/webhook.ts`):
  - Added command handling for `/start`, `/help`, `/link CODE`
  - Successful `/link CODE` now persists `ChannelIdentity` and initializes active conversation state
  - Persists identity mapping after processed messages when `shopId` exists

Validation performed:
- `npx prisma generate` passed with updated schema.
- `npm run build` passed.
- `npm run lint` passed.
- Telegram-focused tests passed:
  - `tests/config-telegram.test.ts`
  - `tests/telegramAuth.test.ts`
  - `tests/telegramMessaging.test.ts`
  - `tests/telegramLinking.test.ts`

Notes:
- Local `prisma migrate dev --create-only` reports existing migration-history drift in the current local DB state.
  - The repository migration files include the new `ChannelIdentity` migration, but applying in this specific local DB requires reconciliation/reset due pre-existing divergence.

## Phase 4 Status Update (Telegram Identity Mapping + Linking)
Date: 2026-03-22

Completed:
- Added `ChannelIdentity` model and relation on `Shop` for cross-channel identity mapping.
- Added migration files for `ChannelIdentity` table, indexes, and unique constraints.
- Added `src/services/channelIdentity.ts` for identity lookup/upsert helpers.
- Added `src/services/telegramLinking.ts` for one-time link code generation/consumption and command parsing.
- Updated Telegram webhook handling:
  - `/start` welcome behavior
  - `/help` usage guidance
  - `/link CODE` linking flow
- Updated agent pipeline to:
  - Resolve Telegram users by mapped identity first
  - Persist Telegram identity mapping after onboarding/known-shop processing
  - Generate link code when phone channels send "link telegram"

Validation completed:
- `npx prisma generate` passed
- `npm run build` passed
- `npm run lint` passed
- Telegram test suite passed:
  - `tests/config-telegram.test.ts`
  - `tests/telegramAuth.test.ts`
  - `tests/telegramMessaging.test.ts`
  - `tests/telegramLinking.test.ts`

Known environment note:
- Local `prisma migrate dev` reports migration drift in the local DB state; code and migration files are present, but local DB history needs reconciliation/reset before applying migrations on this machine.

### Phase 5 - Agent Pipeline Integration (Telegram) (Completed)

Goal completed:
- Telegram messages now run through the same classify/extract/execute pipeline used by SMS/WhatsApp.

Implementation updates:
- Shop resolution order in `processMessage()` now supports external identity lookup first for Telegram:
  - Lookup by `channel=telegram + externalUserId` via `ChannelIdentity`
  - Fallback to phone-based lookup for other channels
- Reused the existing mutation/query pipeline unchanged where possible (classifier, extractors, router, shopUpdater).
- Conversation state/history keying for Telegram remains stable using `from = telegram:{externalUserId}`.
- Ensured Telegram-originated updates execute normal mutation handlers and site rebuild pipeline.
- Added parsed-intent fallback inference in webhook logging so Telegram message logs consistently include `parsedIntent` and `parsedSummary` when state-based intent is not available.

Validation completed:
- Build + lint:
  - `npm run build` passed
  - `npm run lint` passed
- Telegram test suite passed:
  - `tests/config-telegram.test.ts`
  - `tests/telegramAuth.test.ts`
  - `tests/telegramMessaging.test.ts`
  - `tests/telegramLinking.test.ts`
  - `tests/telegram-phase5.integration.test.ts`
- End-to-end Telegram integration validation (`tests/telegram-phase5.integration.test.ts`) verified:
  - Telegram webhook updates DB records (`update_service` on Haircut to $44)
  - Site rebuild generated updated HTML at `/public/sites/{slug}/index.html`
  - Conversation state/history persisted for `telegram:{externalUserId}`
  - Message log row created with:
    - `channel=telegram`
    - `status=PROCESSED`
    - `updateApplied=true`
    - non-empty `parsedIntent` and `parsedSummary`

Environment note:
- Local DB migration history still has drift in this machine's dev DB; tests include safety table-creation for `ChannelIdentity` when absent, but repository migration files remain the source of truth.
