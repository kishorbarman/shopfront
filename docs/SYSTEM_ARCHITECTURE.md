# Shopfront System Architecture

This document maps the key technical components in Shopfront and how they interact across messaging, AI processing, data storage, and website publishing.

## 1) High-Level System Diagram

```mermaid
flowchart TD
  %% External actors and providers
  Owner[Shop Owner]
  Twilio[Twilio SMS / WhatsApp]
  Browser[Customer Browser]
  Anthropic[Anthropic Claude API]
  Gemini[Google Gemini API]

  %% Core app
  API[Fastify App\nsrc/index.ts]
  Webhook[Webhook Routes\nsrc/routes/webhook.ts]
  Agent[Agent Pipeline\nsrc/services/agent.ts]
  Classifier[Intent Classifier\nsrc/agent/classifier.ts]
  Extractors[Entity Extractors\nsrc/agent/extractors.ts]
  Parsers[Onboarding Parsers\nsrc/agent/parsers.ts]
  Router[Intent Router\nsrc/agent/router.ts]
  Updater[Shop Updater\nsrc/services/shopUpdater.ts]
  Messaging[Messaging Service\nsrc/services/messaging.ts]
  SiteBuilder[Site Builder\nsrc/services/siteBuilder.ts]
  TemplateGen[Template Generator\nsrc/templates/generator.ts]
  Pages[Page Routes\nsrc/routes/pages.ts]

  %% Data stores
  PostgreSQL[(PostgreSQL\nPrisma)]
  Redis[(Redis\nConversation State + Rate Limits)]
  FileStore[(Local Filesystem\n/public/sites + /public/uploads)]
  Logs[(Message Logs Table)]

  %% Inbound flow
  Owner -->|SMS / WhatsApp Message| Twilio
  Twilio -->|POST /api/webhook/sms\nPOST /api/webhook/whatsapp| Webhook
  Webhook --> API
  API --> Agent
  Agent --> Redis
  Agent --> PostgreSQL
  Agent --> Classifier
  Agent --> Extractors
  Agent --> Parsers
  Agent --> Router
  Classifier --> Anthropic
  Extractors --> Anthropic
  Parsers --> Anthropic
  Classifier -. optional/provider switch .-> Gemini
  Extractors -. optional/provider switch .-> Gemini
  Parsers -. optional/provider switch .-> Gemini
  Agent --> Updater
  Updater --> PostgreSQL
  Updater --> SiteBuilder
  SiteBuilder --> TemplateGen
  TemplateGen --> FileStore
  Agent --> Messaging
  Messaging -->|Outbound reply| Twilio
  Twilio --> Owner
  Agent --> Logs
  Logs --> PostgreSQL

  %% Public page flow
  Browser -->|GET /s/:slug| Pages
  Pages --> PostgreSQL
  Pages --> FileStore
  Pages --> TemplateGen
  Pages --> Browser
```

## 2) Request-to-Website Update Flow

```mermaid
sequenceDiagram
  participant O as Shop Owner
  participant T as Twilio
  participant W as Webhook Route
  participant A as Agent Pipeline
  participant R as Redis
  participant DB as PostgreSQL (Prisma)
  participant U as ShopUpdater
  participant SB as SiteBuilder
  participant FS as /public/sites
  participant M as Messaging Service

  O->>T: Send text command\n(e.g., "Change haircut to $40")
  T->>W: POST webhook payload
  W->>A: processMessage(InboundMessage)
  A->>R: checkRateLimit + load state/history
  A->>DB: load shop by phone
  A->>A: classify intent + extract entities
  A->>U: execute mutation immediately
  U->>DB: update service/hour/notice/contact
  U->>SB: rebuildSite(shopId)
  SB->>DB: load full shop data
  SB->>FS: write /public/sites/{slug}/index.html
  A->>DB: write MessageLog (parsed summary + applied details)
  A->>M: send response summary text
  M->>T: Twilio outbound message
  T->>O: Delivery to owner
```

## 3) Component Responsibilities

- `Fastify API` (`src/index.ts`): bootstraps env/config, routes, middleware, logger, health/metrics.
- `Webhook Routes` (`src/routes/webhook.ts`): validates inbound provider requests, normalizes payload, calls agent pipeline.
- `Agent Pipeline` (`src/services/agent.ts`): orchestrates rate limits, conversation state, intent parsing/classification, and response generation.
- `Classifier / Extractors / Parsers` (`src/agent/*`): convert natural language into structured intents/entities for onboarding and updates.
- `ShopUpdater` (`src/services/shopUpdater.ts`): applies validated DB mutations and triggers rebuilds.
- `SiteBuilder + Template Generator` (`src/services/siteBuilder.ts`, `src/templates/generator.ts`): generates static HTML from DB data and stores output.
- `Messaging Service` (`src/services/messaging.ts`): provider abstraction for outbound SMS/WhatsApp (and future channels).
- `Pages Route` (`src/routes/pages.ts`): serves prebuilt page from disk if available, else generates and caches.

## 4) Data/State Topology

- `PostgreSQL (Prisma)` stores:
  - Shops, Services, Hours, Notices
  - Message logs for audit/debug visibility on site logs
  - Failed messages (dead-letter flow)
- `Redis` stores:
  - Per-phone conversation state
  - Last messages history (context window)
  - Rate-limit counters (per hour)
- `Filesystem` stores:
  - `public/sites/{slug}/index.html` (prebuilt public pages)
  - `public/uploads/{shopId}/...` (processed media assets)

## 5) Key Integration Boundaries

- Messaging ingress/egress boundary: Twilio webhooks + outbound API calls.
- LLM boundary: provider SDK/API calls for parsing/classification/extraction.
- Persistence boundary: Prisma for durable records, Redis for transient state.
- Rendering boundary: template generation + static file serving.

## 6) Operational Notes

- Rebuild trigger points are attached to successful mutations (services, hours, notices, contact, photo, onboarding completion).
- Public route `GET /s/:slug` supports cache-friendly serving with metadata headers.
- Message logs preserve parsed intent and applied update details for traceability.
