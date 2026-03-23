# Shopfront Operations Commands

## Telegram Commands

- `/help`
  - Shows capabilities and quick guidance.
- `/status`
  - Returns link/status snapshot: shop name, shop status, current conversation mode, and pending action (if any).
- `/site`
  - Returns the live URL for the linked shop: `https://<base>/s/<slug>`.
- `/support`
  - Opens the support path: AI troubleshooting first, then human escalation when confidence is low.
- `/link <CODE>`
  - Links Telegram identity to an existing shop created via phone channel.

## Reliability and Monitoring

- Dead-letter queue stores failed processing and failed outbound deliveries in `FailedMessage`.
- Replay script:
  - `npm run replay:failed`
  - Replays full processing failures and outbound-only failures.
- Metrics endpoint: `GET /metrics`
  - Includes counters for:
    - `webhookAuthFailures`
    - `outboundDeliveryFailures`
    - `rateLimitBlocks`
    - `spamBlocks`

## Guardrails

- Channel-aware hourly limits:
  - SMS: 20/hour
  - WhatsApp: 20/hour
  - Telegram: 60/hour
- Anti-spam duplicate protection:
  - Repeated identical payloads are blocked after 4 duplicates in a 30-second window.
