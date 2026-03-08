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
  - Uses Claude Haiku when API key is available
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
  - Claude Haiku classification path
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
- Updated `.env.example` with `PUBLIC_BASE_URL`
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
