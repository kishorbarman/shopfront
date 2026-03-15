
SHOPFRONT
Implementation Guide
Step-by-Step Build Plan with Claude Code Prompts

13 implementation steps  •  ~12 weeks  •  Ready-to-paste prompts

How to Use This Document
Each step below is a self-contained unit of work you can hand to Claude Code. The steps are sequenced so each builds on the last. For each step you get:

	•	Goal: What you’re building and why
	•	Deliverables: Concrete files and features when done
	•	Claude Code Prompt: Copy-paste ready prompt (in the yellow box)
	•	Verification: How to confirm the step is complete

Tips for working with Claude Code:
	•	Start each step in a fresh session if the previous one is complete and tested
	•	If a step is too large, ask Claude Code to break it down further
	•	Always run the verification checks before moving to the next step
	•	Commit to git after each step passes verification

Phase 1: Project Foundation
Set up the project skeleton, database, and local dev environment. After this phase you’ll have a running server that can receive webhooks and talk to a database.

Step 1: Project Scaffolding
Initialize the TypeScript project with all dependencies, linting, and project structure.

Deliverables
	•	Node.js + TypeScript project with strict tsconfig
	•	Fastify server with health check endpoint
	•	ESLint + Prettier configuration
	•	Folder structure: src/routes, src/services, src/models, src/agent, src/templates
	•	.env.example with all required environment variables
	•	Docker Compose file for local PostgreSQL + Redis
	•	package.json scripts: dev, build, start, lint, test
▶ CLAUDE CODE PROMPT
Initialize a new TypeScript project called "shopfront" for a text-to-website
platform. Here are the requirements:
 
TECH STACK:
- Runtime: Node.js with TypeScript (strict mode)
- Framework: Fastify
- Database: PostgreSQL via Prisma ORM
- Cache: Redis via ioredis
- LLM: Google Gemini API
- SMS/WhatsApp: Twilio (twilio package)
- Linting: ESLint + Prettier
 
PROJECT STRUCTURE:
src/
  index.ts              -- Fastify server entry point, loads .env
  routes/
    webhook.ts          -- Twilio inbound message webhook handlers
    health.ts           -- GET /health endpoint
  services/
    messaging.ts        -- Twilio SMS + WhatsApp send/receive abstraction
    agent.ts            -- LLM agent pipeline (classify + extract)
    siteBuilder.ts      -- HTML generation from shop data
  models/
    types.ts            -- Shared TypeScript types/interfaces
  agent/
    prompts.ts          -- System prompts and prompt templates
    intents.ts          -- Intent definitions and schemas
  templates/
    base.html           -- Base HTML template for shop pages
prisma/
  schema.prisma         -- Database schema (empty for now)
docker-compose.yml      -- PostgreSQL 16 + Redis 7
.env.example            -- All env vars with placeholder values
 
REQUIREMENTS:
- Fastify server on port 3000 (configurable via PORT env var)
- GET /health returns { status: "ok", timestamp: <iso> }
- Use dotenv for environment config
- TypeScript strict mode with path aliases (@/ -> src/)
- Add scripts: "dev" (tsx watch), "build" (tsc), "start" (node dist), "lint", "test"
- Add a README.md with setup instructions
- Initialize git with a .gitignore (node_modules, dist, .env, etc.)
 
Do NOT implement any business logic yet. Just the skeleton with
all dependencies installed and a working "hello world" server.

Verification
	•	npm run dev starts the server without errors
	•	curl localhost:3000/health returns 200 with JSON
	•	docker compose up starts PostgreSQL and Redis
	•	npm run lint passes with no errors
	•	npm run build compiles without errors

Step 2: Database Schema & Migrations
Define the full Prisma schema for multi-tenant shop data and run the first migration.

Deliverables
	•	Prisma schema with all tables: shops, services, hours, notices
	•	Initial migration applied to local PostgreSQL
	•	Seed script with one example shop (Tony’s Barbershop)
	•	Prisma Client generated and importable
▶ CLAUDE CODE PROMPT
Set up the Prisma database schema for the Shopfront platform. This is a
multi-tenant system where each shop is identified by the owner's phone number.
 
SCHEMA DESIGN:
 
model Shop {
  id          String    @id @default(uuid())
  name        String
  slug        String    @unique    // URL path: shopfront.page/{slug}
  category    String               // "barber", "salon", "restaurant", etc.
  phone       String    @unique    // Owner's phone in E.164 format (tenant key)
  address     String?
  latitude    Float?
  longitude   Float?
  photoUrl    String?
  status      ShopStatus @default(ONBOARDING)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  services    Service[]
  hours       Hour[]
  notices     Notice[]
}
 
enum ShopStatus {
  ONBOARDING
  ACTIVE
  PAUSED
  CHURNED
}
 
model Service {
  id          String   @id @default(uuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])
  name        String
  price       Decimal  @db.Decimal(10, 2)
  description String?
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
 
  @@index([shopId])
}
 
model Hour {
  id          String   @id @default(uuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])
  dayOfWeek   Int               // 0=Sunday, 6=Saturday
  openTime    String            // "09:00" (stored as string for simplicity)
  closeTime   String            // "19:00"
  isClosed    Boolean  @default(false)
 
  @@unique([shopId, dayOfWeek])
  @@index([shopId])
}
 
model Notice {
  id          String    @id @default(uuid())
  shopId      String
  shop        Shop      @relation(fields: [shopId], references: [id])
  message     String
  type        NoticeType @default(INFO)
  startsAt    DateTime  @default(now())
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())
 
  @@index([shopId])
}
 
enum NoticeType {
  INFO
  WARNING
  CLOSURE
}
 
ALSO:
1. Create prisma/seed.ts that inserts a sample shop "Tony's Barbershop":
   - Category: barber, slug: tonys-barbershop
   - Services: Haircut $25, Fade $30, Beard Trim $15, Hot Towel Shave $20, Kids Cut $18
   - Hours: Mon-Sat 9:00-19:00, Sun closed
   - Address: "742 Evergreen Terrace, Springfield"
   - Status: ACTIVE
 
2. Add "prisma:migrate" and "prisma:seed" scripts to package.json
3. Create src/lib/prisma.ts that exports a singleton PrismaClient instance
4. Make sure the DATABASE_URL in .env.example matches docker-compose PostgreSQL
 
Run the migration and seed. Verify the data is in the database.

Verification
	•	npx prisma migrate dev runs without errors
	•	npx prisma db seed inserts Tony’s Barbershop
	•	npx prisma studio shows all tables with seed data

Step 3: Twilio Webhook + Message Abstraction
Set up inbound message handling from both SMS and WhatsApp, with a unified message type that the rest of the system works with.

Deliverables
	•	POST /api/webhook/sms and /api/webhook/whatsapp endpoints
	•	Unified InboundMessage type abstraction
	•	Twilio signature validation middleware
	•	Outbound sendMessage() function that works for both channels
	•	ngrok setup instructions for local testing
	•	Message logging for debugging
▶ CLAUDE CODE PROMPT
Implement the Twilio messaging layer for Shopfront. The system receives
messages from both SMS and WhatsApp, normalizes them into a unified format,
and can send responses back through either channel.
 
INBOUND WEBHOOKS:
- POST /api/webhook/sms    -- receives Twilio SMS webhooks
- POST /api/webhook/whatsapp -- receives Twilio WhatsApp webhooks
- Both should validate Twilio request signatures (use twilio.validateRequest)
- Both should parse the Twilio webhook body into a unified InboundMessage:
 
interface InboundMessage {
  id: string;                    // Twilio MessageSid
  from: string;                  // E.164 phone number (normalized, strip "whatsapp:" prefix)
  to: string;                    // Our Twilio number
  body: string;                  // Message text
  mediaUrls: string[];           // MMS/WhatsApp media URLs (if any)
  channel: "sms" | "whatsapp";   // Which channel this came from
  timestamp: Date;
}
 
OUTBOUND MESSAGING:
Create src/services/messaging.ts with:
 
interface OutboundMessage {
  to: string;          // E.164 phone
  body: string;        // Message text
  channel: "sms" | "whatsapp";
  mediaUrl?: string;   // Optional image to send
}
 
async function sendMessage(msg: OutboundMessage): Promise<string>
  -- Uses Twilio client to send via the correct channel
  -- For WhatsApp, prepends "whatsapp:" to the from/to numbers
  -- Returns the Twilio MessageSid
  -- Logs the outbound message
 
MESSAGE PIPELINE:
After parsing the InboundMessage, the webhook handler should:
1. Log the message (console.log for now, structured logging later)
2. Call a placeholder function processMessage(message: InboundMessage)
   that for now just echoes back: "Got your message: {body}"
3. Return 200 with TwiML empty response (Twilio expects this)
 
ENVIRONMENT VARIABLES (add to .env.example):
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_SMS_NUMBER      (e.g., +1234567890)
- TWILIO_WHATSAPP_NUMBER (e.g., +1234567890)
 
TESTING:
- Create a test script scripts/test-webhook.ts that simulates a Twilio
  webhook POST to localhost:3000/api/webhook/sms with a sample payload
  (skip signature validation in test mode via SKIP_TWILIO_VALIDATION=true)
- Include instructions in README for setting up ngrok for real testing
 
Do NOT implement the agent logic yet. The processMessage function is
a placeholder that will be filled in the next step.

Verification
	•	Test script successfully sends a simulated SMS webhook and gets echo response
	•	WhatsApp webhook endpoint accepts and normalizes messages
	•	Twilio signature validation rejects unsigned requests (when enabled)
	•	sendMessage() function works for both SMS and WhatsApp channels

Step 4: Redis Conversation State
Implement conversation state management so the agent can track where each shop owner is in the flow.

Deliverables
	•	Redis connection with ioredis
	•	ConversationState type and state management functions
	•	Rate limiting per phone number
	•	Message history storage (last 10 messages per user)
▶ CLAUDE CODE PROMPT
Implement Redis-based conversation state management for Shopfront.
Each shop owner's phone number maps to a conversation state that tracks
their current mode, any pending actions, and recent message history.
 
REDIS CONNECTION:
- Create src/lib/redis.ts with a singleton ioredis client
- Add REDIS_URL to .env.example (default: redis://localhost:6379)
- Handle connection errors gracefully with logging
 
CONVERSATION STATE:
Create src/services/conversationState.ts:
 
interface ConversationState {
  mode: "onboarding" | "active" | "awaiting_confirmation";
  onboardingStep?: number;          // Which step of onboarding (1-7)
  pendingAction?: {
    intent: string;                 // e.g., "update_service"
    data: Record<string, any>;      // Extracted entities
    confirmationMessage: string;    // What we asked the user to confirm
  };
  shopId?: string;                  // Set after onboarding or lookup
  lastMessageAt: string;            // ISO timestamp
}
 
FUNCTIONS:
async function getState(phone: string): Promise<ConversationState | null>
async function setState(phone: string, state: ConversationState): Promise<void>
  -- TTL: 24 hours (refreshed on each update)
async function clearState(phone: string): Promise<void>
 
MESSAGE HISTORY:
async function addMessage(phone: string, role: "user" | "agent", content: string): Promise<void>
  -- Pushes to a Redis list, trims to last 10 messages
  -- TTL: 7 days
async function getHistory(phone: string): Promise<Array<{role: string, content: string}>>
 
RATE LIMITING:
async function checkRateLimit(phone: string): Promise<{allowed: boolean, remaining: number}>
  -- Max 20 messages per hour per phone number
  -- Uses Redis INCR with 1-hour TTL
  -- Returns whether the message is allowed and remaining count
 
Update the webhook processMessage() placeholder to:
1. Check rate limit (return "slow down" message if exceeded)
2. Load or create conversation state
3. Add inbound message to history
4. Log the current state
5. Still echo for now, but include the state mode in the echo
 
Write unit tests for state management functions using a test Redis instance.

Verification
	•	State is persisted and retrievable across requests for the same phone number
	•	Message history stores and trims correctly at 10 messages
	•	Rate limiter blocks after 20 messages in an hour
	•	Unit tests pass

Phase 2: AI Agent Core
Build the conversational AI agent that understands shop owner messages and translates them into structured data operations. This is the heart of the product.

Step 5: Onboarding Flow
The guided conversation that creates a new shop from scratch through text messages.

Deliverables
	•	Onboarding state machine (steps 1–7)
	•	LLM-powered parsing for each onboarding step
	•	Confirmation messages at each step
	•	Shop + services + hours created in PostgreSQL on completion
	•	Slug generation from business name
▶ CLAUDE CODE PROMPT
Implement the onboarding flow for new Shopfront users. When a message
arrives from an unknown phone number (no shop in DB), the agent walks
them through creating their page step by step.
 
ONBOARDING STATE MACHINE:
The flow has 7 steps. After each step, the agent processes the response,
stores the data, and moves to the next step. Create src/agent/onboarding.ts:
 
Step 1 - WELCOME: 
  Agent sends: "Hey! I'm Shopfront - I'll get your page live in a few minutes. What's your business called?"
  Parse: Extract business name from response
 
Step 2 - CATEGORY:
  Agent sends: "What kind of business is {name} - barber, salon, restaurant, or something else?"
  Parse: Match to known categories or accept custom
 
Step 3 - SERVICES:
  Agent sends: "List your services and prices however feels natural. Like: 'Haircut $25, Fade $30'"
  Parse: Use Gemini to extract name/price pairs from free-form text
  Confirm: Show parsed list back, ask "Look right?"
 
Step 4 - SERVICES_CONFIRM:
  If user says yes/looks good/correct -> proceed
  If user corrects -> re-parse and re-confirm
 
Step 5 - HOURS:
  Agent sends: "What are your hours? Like: 'Mon-Fri 9-6, Sat 10-4, closed Sunday'"
  Parse: Use Gemini to extract day/time ranges into structured hours
 
Step 6 - ADDRESS:
  Agent sends: "What's your address? Helps customers find you."
  Parse: Accept as-is (geocoding later)
 
Step 7 - COMPLETE:
  Create shop, services, hours in database
  Generate slug from name (lowercase, hyphenated, deduplicated)
  Set shop status to ACTIVE
  Send: "Your page is live! shopfront.page/{slug} - You can update anything 
  anytime, just text me."
  Set conversation state mode to "active"
 
LLM INTEGRATION:
Create src/agent/parsers.ts with parsing functions that use Gemini Flash:
 
async function parseBusinessName(text: string): Promise<string>
async function parseCategory(text: string): Promise<string>
async function parseServices(text: string): Promise<Array<{name: string, price: number}>>
async function parseHours(text: string): Promise<Array<{dayOfWeek: number, open: string, close: string, isClosed: boolean}>>
 
Each parser should:
- Send a focused prompt to Claude with clear extraction instructions
- Use the system prompt: "You are a data extraction assistant. Extract 
  structured data from the user's message. Respond ONLY with valid JSON."
- Handle edge cases (missing prices, ambiguous times, etc.)
- Return parsed data or null if unparseable
 
SLUG GENERATION:
- Lowercase the name, replace spaces/special chars with hyphens
- Remove consecutive hyphens, trim
- If slug exists, append -2, -3, etc.
 
WIRE IT UP:
Update processMessage() to:
1. If no shop exists for this phone -> enter onboarding
2. Load onboarding step from conversation state
3. Call the appropriate parser for the current step
4. Send the next message
5. Update conversation state
 
Write integration tests that simulate a full onboarding conversation:
- Send "Hi" from a new number -> expect welcome message
- Send "Tony's Barbershop" -> expect category question
- Send "Barber" -> expect services question
- Send "Haircut 25, fade 30" -> expect confirmation
- Send "Yes" -> expect hours question
- etc.

Verification
	•	A full onboarding conversation from new number results in shop + services + hours in DB
	•	Slug is generated correctly and is unique
	•	Conversation state tracks step progression
	•	Parsers handle messy input ("haircut twenty five", "mon thru fri 9-6")
	•	Integration tests pass for the happy path

Step 6: Intent Classification Pipeline
For existing shop owners, classify what they want to do and route to the right handler.

Deliverables
	•	Intent classifier using Gemini Flash
	•	Confidence scoring and clarification triggers
	•	Intent routing to handler functions (stubs for now)
▶ CLAUDE CODE PROMPT
Implement the intent classification pipeline for messages from existing
shop owners. When a message comes from a known phone number (shop exists
in DB), classify what action they want to take.
 
INTENT TAXONOMY:
Create src/agent/intents.ts with:
 
type IntentCategory =
  | "add_service"       // "Add lineup for $10"
  | "update_service"    // "Change haircut to $28"
  | "remove_service"    // "Remove hot towel shave"
  | "update_hours"      // "Open til 8 on Fridays"
  | "temp_closure"      // "Closed next Monday"
  | "update_contact"    // "New number is 555-1234"
  | "update_photo"      // (has media) "Make this my main photo"
  | "add_notice"        // "Put up a sign: cash only"
  | "remove_notice"     // "Take down the vacation notice"
  | "query"             // "What's my fade price?"
  | "greeting"          // "Hey", "Hi there"
  | "help"              // "What can you do?"
  | "unknown"           // Unparseable
 
interface ClassificationResult {
  intent: IntentCategory;
  confidence: number;          // 0-1
  needsClarification: boolean;
  clarificationQuestion?: string;
  rawEntities?: Record<string, any>;  // Preliminary entity extraction
}
 
CLASSIFIER:
Create src/agent/classifier.ts:
 
async function classifyIntent(
  message: string,
  shopContext: { name: string; services: string[]; },
  history: Array<{role: string, content: string}>
): Promise<ClassificationResult>
 
Implementation:
- Use Gemini Flash for speed and cost efficiency
- System prompt should include:
  * The list of supported intents with examples
  * The shop's current services list (so it can match "change the fade" to the right service)
  * Instruction to return JSON with intent, confidence, needsClarification
- If confidence < 0.7, set needsClarification = true
- If message has media attachments and mentions photo/image/picture, classify as update_photo
- For "greeting" intent, respond warmly and ask how you can help
- For "help" intent, list what the agent can do
 
ROUTING:
Create src/agent/router.ts:
 
async function routeMessage(
  message: InboundMessage,
  classification: ClassificationResult,
  state: ConversationState,
  shop: Shop
): Promise<string>  // Returns the response text to send back
 
For now, create STUB handlers that return placeholder messages:
- add_service -> "I'll add that service for you. (not implemented yet)"
- update_service -> "I'll update that service. (not implemented yet)"
- query -> "Let me look that up. (not implemented yet)"
- etc.
- If needsClarification -> return the clarificationQuestion
- If unknown -> "I can help with your services, hours, and photos. What would you like to update?"
 
Wire the classifier into processMessage():
1. Look up shop by phone
2. Load conversation state and history
3. Classify intent
4. Route to handler
5. Send response
 
Write tests with diverse message examples for each intent category.
Include edge cases: typos, slang, mixed intents.

Verification
	•	Classifier correctly identifies all intent categories from sample messages
	•	Confidence scoring triggers clarification for ambiguous messages
	•	Router dispatches to the correct stub handler
	•	Shop context (service names) improves classification accuracy
	•	Tests cover at least 5 example messages per intent category

Step 7: Entity Extraction + Update Handlers
Implement the full update handlers that extract structured data, confirm with the user, and mutate the database.

Deliverables
	•	Entity extraction for each intent using Gemini Pro with tool use
	•	Confirmation flow with pending action in state
	•	Database mutations for all CRUD operations
	•	Query handler that reads and responds with current data
▶ CLAUDE CODE PROMPT
Implement all update handlers for Shopfront. Each handler extracts
structured data from the user's message, confirms the action, and
applies the change to the database.
 
ENTITY EXTRACTION:
Create src/agent/extractors.ts. Use Gemini Pro with function/tool
calling to extract structured entities. Define tool schemas for each intent:
 
For add_service:
  Tool: add_service({ name: string, price: number, description?: string })
  Example: "Add lineup for $10" -> { name: "Lineup", price: 10 }
 
For update_service:
  Tool: update_service({ serviceName: string, newPrice?: number, newName?: string })
  Must match against existing services (fuzzy match)
  Example: "Change haircut to $28" -> { serviceName: "Haircut", newPrice: 28 }
 
For remove_service:
  Tool: remove_service({ serviceName: string })
  Fuzzy match against existing services
 
For update_hours:
  Tool: update_hours({ changes: Array<{dayOfWeek: number, openTime?: string, closeTime?: string, isClosed?: boolean}> })
  Example: "Open til 8 on Fridays" -> { changes: [{dayOfWeek: 5, closeTime: "20:00"}] }
 
For temp_closure:
  Tool: add_temp_closure({ message: string, startsAt: string, expiresAt: string })
  Example: "Closed next Monday" -> calculate dates, add notice with expiry
 
For update_contact:
  Tool: update_contact({ field: "phone" | "address", value: string })
 
For add_notice:
  Tool: add_notice({ message: string, type: "info" | "warning" })
 
For query:
  No mutation. Read the requested data and format a response.
  "What's my fade price?" -> "Fade is currently $30."
  "Show my hours" -> format and return current hours
 
CONFIRMATION FLOW:
For ALL mutation intents (not queries):
1. Extract entities
2. Build a human-readable confirmation message
3. Store as pendingAction in conversation state (mode: "awaiting_confirmation")
4. Send confirmation: "I'll update Fade to $35. Sound good?"
5. On next message:
   - If affirmative (yes/yeah/looks good/do it/correct): execute the mutation
   - If negative (no/cancel/never mind): clear pending action, ask what they want instead
   - If they send a new unrelated message: clear pending action, classify the new message
 
DATABASE MUTATIONS:
Create src/services/shopUpdater.ts with functions:
  addService(shopId, { name, price, description })
  updateService(shopId, serviceName, updates)
  removeService(shopId, serviceName)  -- soft delete (isActive=false)
  updateHours(shopId, changes)
  addNotice(shopId, { message, type, startsAt, expiresAt })
  removeNotice(shopId, noticeId)
  updateContact(shopId, field, value)
 
Each function should:
- Validate input
- Apply the change via Prisma
- Return the updated record
- Update shop.updatedAt timestamp
 
RESPONSE MESSAGES:
After successful mutation, send a concise confirmation:
- "Done! Lineup ($10) added to your menu."
- "Updated! Fade is now $35."
- "Removed! Hot Towel Shave is off your menu."
- "Got it! You're marked as closed next Monday."
 
Write integration tests for each handler:
1. Test entity extraction with various phrasings
2. Test the full confirm -> execute flow
3. Test cancellation mid-confirmation
4. Test query responses for services, hours, and notices

Verification
	•	Each update handler extracts entities correctly from natural language
	•	Confirmation flow works: confirm executes, cancel aborts, new message redirects
	•	Database reflects all mutations correctly
	•	Query handler returns accurate current data
	•	Fuzzy matching finds services even with typos or abbreviations

Step 8: Photo Handling
Handle MMS/WhatsApp images for shop profile photos and galleries.

Deliverables
	•	Media download from Twilio URLs
	•	Image optimization and storage
	•	Photo update flow (banner vs gallery)
▶ CLAUDE CODE PROMPT
Implement photo handling for Shopfront. Shop owners can send photos via
MMS (SMS) or WhatsApp, and the agent should update their shop page.
 
MEDIA DOWNLOAD:
When an InboundMessage has mediaUrls, download the images:
- Twilio media URLs require authentication (use Account SID + Auth Token)
- Download to a temp directory first
- Validate: must be image (JPEG, PNG, WebP), max 10MB
 
IMAGE PROCESSING:
Use 'sharp' package to:
- Resize to max 1200px wide (preserve aspect ratio)
- Convert to WebP for web delivery
- Generate a thumbnail (400px wide) for previews
- Strip EXIF data for privacy
 
STORAGE:
For MVP, store images in the local filesystem under /public/uploads/{shopId}/
Later this will be moved to Cloudflare R2 or S3.
Create src/services/mediaStorage.ts:
 
async function storeImage(shopId: string, imageBuffer: Buffer, filename: string): 
  Promise<{ url: string, thumbnailUrl: string }>
 
AGENT FLOW:
When a message has media:
1. If message includes text about "banner", "main photo", "profile" -> update shop.photoUrl
2. If message is just a photo with no context -> ask: "Nice photo! Should I
   use this as your main banner, or add it to your gallery?"
3. Store the photo and update the database
4. Confirm: "Done! Your new banner photo is live."
 
Add 'sharp' to dependencies and write tests for the image pipeline.

Verification
	•	Photos from MMS/WhatsApp are downloaded and stored correctly
	•	Images are resized, converted to WebP, and thumbnailed
	•	Agent correctly handles banner vs gallery photo intent

Phase 3: Website Generation
Build the public-facing shop pages that are generated from database data and deployed to the edge.

Step 9: HTML Template Engine
Create beautiful, mobile-first shop pages generated from structured data.

Deliverables
	•	Base HTML template with all shop sections
	•	Category-specific variations (barber, restaurant, general)
	•	Mobile-first responsive design
	•	Build function: shop data in, HTML file out
▶ CLAUDE CODE PROMPT
Build the website generation engine for Shopfront. Each shop gets a
clean, fast, mobile-first single page generated from their database data.
 
TEMPLATE SYSTEM:
Create src/templates/generator.ts:
 
async function generateShopPage(shop: Shop & {
  services: Service[];
  hours: Hour[];
  notices: Notice[];
}): Promise<string>   // Returns complete HTML string
 
PAGE STRUCTURE (single HTML file, no JS required):
1. HEADER: Shop name, category badge, banner photo (or gradient default)
2. NOTICES: Active notices shown as banners (info=blue, warning=yellow, closure=red)
3. SERVICES/MENU: Clean list with service name, description, and price
4. HOURS: Table showing each day with open/close times. Highlight today.
   Show "Closed" in red for closed days.
5. LOCATION: Address with a link to Google Maps
6. CONTACT: Tap-to-call button, tap-to-text button
7. FOOTER: "Powered by Shopfront" with small branding
 
DESIGN REQUIREMENTS:
- Mobile-first (most customers will view on phone)
- Fast: Pure HTML + CSS, no JavaScript, no external fonts (use system font stack)
- Clean, modern look with good whitespace
- Colors: Use a neutral base with the category as an accent
  * Barber: deep green/gold
  * Restaurant: warm red/brown  
  * Salon: soft purple/pink
  * General: blue/slate
- Services list should look like a real menu/price list
- Large tap targets for phone numbers and addresses
- Total page size under 50KB (excluding images)
 
SEO & SOCIAL:
Include in <head>:
- <title>{Shop Name} - {Category} | Services & Hours</title>
- <meta name="description"> with shop name, category, and top 3 services
- Open Graph tags (og:title, og:description, og:image, og:url)
- Schema.org LocalBusiness JSON-LD structured data
- <meta name="viewport" content="width=device-width, initial-scale=1">
 
CATEGORY TEMPLATES:
Create at least 2 visual variations:
1. "services" template (barber, salon, auto repair) - list-based
2. "menu" template (restaurant, food truck, bakery) - menu/grid style
 
STATIC FILE SERVING:
Add a route to Fastify: GET /s/:slug that:
1. Looks up the shop by slug
2. Loads services, hours, active notices
3. Generates HTML
4. Returns with appropriate cache headers (Cache-Control: public, max-age=300)
 
For MVP, generate on every request. Later we'll pre-build and cache.
 
Create a preview route GET /preview/:shopId for testing during development
that generates the page without requiring a custom domain.
 
Write visual tests: generate pages for Tony's Barbershop and a sample
restaurant, save as HTML files for manual review.

Verification
	•	GET /s/tonys-barbershop returns a complete, styled HTML page
	•	Page passes Lighthouse mobile audit > 90 for performance
	•	Page looks good on mobile (320px) and desktop (1280px)
	•	All sections render: services with prices, hours, notices, contact
	•	Schema.org JSON-LD is valid

Step 10: Site Rebuild Pipeline
Trigger page rebuilds when shop data changes, and wire up the full loop from text message to live site update.

Deliverables
	•	Rebuild trigger after every database mutation
	•	Pre-built HTML cache (write to disk or memory)
	•	Full loop working: text message → agent → DB update → page reflects change
▶ CLAUDE CODE PROMPT
Wire up the complete text-to-website loop for Shopfront. When a shop
owner sends a text that updates their data, the website should reflect
the change within seconds.
 
REBUILD PIPELINE:
Create src/services/siteBuilder.ts:
 
async function rebuildSite(shopId: string): Promise<void>
  1. Load full shop data from PostgreSQL (shop + services + hours + notices)
  2. Generate HTML using the template generator
  3. Write to disk: public/sites/{slug}/index.html
  4. Log: "Rebuilt site for {shop.name} at /s/{slug}"
 
TRIGGER POINTS:
Add rebuildSite() call after every successful mutation in shopUpdater.ts:
- After addService, updateService, removeService
- After updateHours
- After addNotice, removeNotice
- After updateContact (if address changes)
- After photo upload
- After onboarding completion (first build)
 
STATIC FILE SERVING:
Update the GET /s/:slug route to:
1. First check for pre-built file at public/sites/{slug}/index.html
2. If exists, serve it (with cache headers)
3. If not, generate on-the-fly, write to disk, then serve
4. Add ETag or Last-Modified headers based on shop.updatedAt
 
FULL LOOP TEST:
Create an end-to-end test script scripts/test-full-loop.ts that:
1. Simulates a new user onboarding via webhook
2. Verifies the shop page is generated and accessible
3. Simulates "Change haircut to $30" via webhook
4. Fetches the page again and verifies the price updated
5. Simulates "Closed next Monday" via webhook
6. Verifies the notice appears on the page
 
This is the moment everything comes together. After this step, the core
product loop is functional end to end.

Verification
	•	Sending "add lineup for $10" via SMS results in the service appearing on the live page
	•	Pre-built HTML is served correctly with cache headers
	•	Full loop e2e test passes
	•	Page rebuilds complete in under 2 seconds

Phase 4: Production Readiness
Harden the system, add deployment infrastructure, monitoring, and billing.

Step 11: Deployment & Infrastructure
Get the system running in production with proper hosting, domain setup, and CI/CD.

Deliverables
	•	Dockerfile and production build
	•	Railway/Render deployment configuration
	•	Production PostgreSQL and Redis setup
	•	Custom domain with SSL
	•	GitHub Actions CI/CD pipeline
▶ CLAUDE CODE PROMPT
Set up production deployment for Shopfront.
 
DOCKER:
Create a multi-stage Dockerfile:
- Stage 1: Install dependencies and build TypeScript
- Stage 2: Production image with only dist/ and node_modules
- Keep image small (use node:20-slim)
- Run as non-root user
- EXPOSE 3000
 
Create docker-compose.prod.yml with:
- shopfront app service
- PostgreSQL 16 with persistent volume
- Redis 7 with persistent volume
 
ENVIRONMENT CONFIGURATION:
Create src/config.ts that validates all required env vars on startup:
- NODE_ENV (development | production)
- PORT
- DATABASE_URL
- REDIS_URL
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_NUMBER, TWILIO_WHATSAPP_NUMBER
- GEMINI_API_KEY
- BASE_URL (e.g., https://shopfront.page)
Fail fast with clear error messages if any are missing.
 
CI/CD:
Create .github/workflows/deploy.yml:
- On push to main: lint, test, build, deploy
- Run tests against a test PostgreSQL (use GitHub Actions service containers)
- Deploy to Railway/Render via their GitHub integration or CLI
 
PRODUCTION HARDENING:
- Add request logging with pino (Fastify's built-in logger)
- Add CORS configuration
- Add Helmet for security headers
- Add graceful shutdown handling (close DB, Redis, server)
- Set Fastify trustProxy for correct IP detection behind proxy
- Add a /metrics endpoint for basic health stats (uptime, request count, 
  active shops count)
 
Create deployment documentation in docs/DEPLOY.md with step-by-step
instructions for deploying to Railway.

Verification
	•	Docker build succeeds and container runs correctly
	•	App starts and validates all environment variables
	•	CI/CD pipeline runs on push and deploys
	•	Health endpoint is accessible on production URL
	•	Twilio webhooks point to production URL and messages flow through

Step 12: Error Handling, Logging & Monitoring
Add robust error handling, structured logging, and alerting so you know when things break.

Deliverables
	•	Sentry integration for error tracking
	•	Structured logging with context
	•	Agent error recovery (graceful fallbacks)
	•	Dead letter queue for failed messages
▶ CLAUDE CODE PROMPT
Add production-grade error handling and monitoring to Shopfront.
 
ERROR HANDLING:
Create src/lib/errors.ts with custom error classes:
- AgentParseError: LLM failed to parse user message
- AgentConfidenceError: Classification confidence too low
- DatabaseError: Prisma operation failed
- MessagingError: Twilio send/receive failed
- RateLimitError: User exceeded rate limit
- ValidationError: Invalid data from extraction
 
GRACEFUL FALLBACKS:
Update the agent pipeline so that errors never result in silence:
- LLM API timeout/error: "Sorry, I'm having a moment. Try sending that again?"
- Parse failure: "I didn't quite catch that. Are you trying to update your services, hours, or something else?"
- Database error: "Something went wrong on my end. Your change didn't go through - try again in a minute?"
- Rate limit: "You're sending a lot of messages! Give me a minute to catch up."
- Unknown error: "Something unexpected happened. Text me again and I'll try my best."
 
Every error should be:
1. Caught and logged with full context (phone, message, intent, error stack)
2. Reported to Sentry with tags (shopId, intent, channel)
3. Result in a friendly fallback message to the user
4. Never expose internal details to the user
 
STRUCTURED LOGGING:
Use pino with structured JSON logs:
- Every inbound message: { event: "message_received", phone, channel, bodyLength, hasMedia }
- Every classification: { event: "intent_classified", phone, intent, confidence, durationMs }
- Every mutation: { event: "shop_updated", shopId, intent, success }
- Every outbound message: { event: "message_sent", phone, channel, bodyLength }
- Every error: { event: "error", type, phone, shopId, message, stack }
 
DEAD LETTER QUEUE:
If a message completely fails processing (3 retries), store it in a
PostgreSQL table "failed_messages" with the full message payload, error
details, and timestamp. This allows manual review and replay.
 
Create a simple admin script scripts/replay-failed.ts that retries
failed messages.
 
SENTRY SETUP:
- Add @sentry/node
- Initialize in src/index.ts before anything else
- Add Sentry request handler and error handler middleware
- Tag errors with shopId, channel, intent
- Add SENTRY_DSN to env configuration

Verification
	•	LLM timeout results in friendly fallback, not silence or crash
	•	All errors appear in Sentry with proper tags and context
	•	Structured logs include all key events with correct fields
	•	Failed messages are stored and can be replayed

Step 13: Billing & Growth Features
Add Stripe billing, analytics, and engagement features to turn this into a business.

Deliverables
	•	Stripe subscription integration
	•	Free trial flow (14 days)
	•	Basic analytics (page views per shop)
	•	Weekly summary text to shop owners
▶ CLAUDE CODE PROMPT
Add billing and growth features to Shopfront.
 
STRIPE BILLING:
Create src/services/billing.ts:
 
PRICING:
- Free trial: 14 days, full features, no card required
- Basic plan: $15/month (text updates, single page, 1 photo)
- Pro plan: $25/month (unlimited photos, custom domain, analytics)
 
Flow:
1. On onboarding complete, create a Stripe customer for the shop
2. Start 14-day trial (store trialEndsAt in shops table)
3. On day 12, text the owner: "Your free trial ends in 2 days! 
   Reply SUBSCRIBE to keep your page live at $15/mo."
4. On "SUBSCRIBE" response:
   - Generate a Stripe Checkout link (hosted payment page)
   - Text: "Here's your payment link: {checkout_url}"
   - Stripe webhook confirms subscription
5. On trial expiry without subscription:
   - Set shop status to PAUSED
   - Page shows "This business page is temporarily unavailable"
   - Text: "Your trial ended. Reply SUBSCRIBE anytime to reactivate."
 
Stripe webhook endpoint: POST /api/webhook/stripe
Handle: checkout.session.completed, customer.subscription.deleted,
invoice.payment_failed
 
Add to shops table:
- stripeCustomerId: String?
- stripeSubscriptionId: String?
- plan: ENUM (TRIAL, BASIC, PRO, EXPIRED)
- trialEndsAt: DateTime?
 
ANALYTICS:
Add a simple page view counter:
- On each GET /s/:slug request, increment a Redis counter: views:{slug}:{date}
- Create a daily cron job that flushes Redis counters to a PostgreSQL
  table "page_views" (shopId, date, count)
- This data powers the weekly summary
 
WEEKLY SUMMARY:
Create a cron job (node-cron or similar) that runs every Monday at 9am:
For each active shop:
  "Hey {name}! Last week your page got {views} views. Your most popular 
  service is {topService}. Reply anytime to update your page."
 
Only send if the shop had at least 1 view (don't spam inactive pages).
 
Add dependencies: stripe, node-cron
Add env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_BASIC_PRICE_ID, 
STRIPE_PRO_PRICE_ID

Verification
	•	Stripe checkout link is generated and texted to shop owner
	•	Stripe webhook correctly activates subscription
	•	Trial expiry pauses the shop and notifies the owner
	•	Page view counter increments on each visit
	•	Weekly summary text is sent with accurate view counts

Quick Reference: Step Dependency Map

Step
Name
Depends On
Estimated Time
1
Project Scaffolding
None
2-3 hours
2
Database Schema
Step 1
2-3 hours
3
Twilio Webhooks
Step 1
3-4 hours
4
Redis State
Step 1
2-3 hours
5
Onboarding Flow
Steps 2, 3, 4
6-8 hours
6
Intent Classification
Steps 2, 3, 4
4-6 hours
7
Update Handlers
Steps 5, 6
6-8 hours
8
Photo Handling
Step 7
3-4 hours
9
HTML Templates
Step 2
6-8 hours
10
Rebuild Pipeline
Steps 7, 9
3-4 hours
11
Deployment
Step 10
4-6 hours
12
Error Handling
Step 10
4-6 hours
13
Billing & Growth
Step 11
6-8 hours

Steps 1-4 can be parallelized (foundation work). Steps 5-8 must be sequential (agent logic). Steps 9 and 5-8 can run in parallel (website templates are independent of agent work). Steps 11-13 are sequential and come after the core loop (Step 10) is working.

Total estimated build time: 47–63 hours of focused Claude Code sessions, or roughly 8–12 weeks of part-time work.

Ship it.
