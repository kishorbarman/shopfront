# Shopfront Deployment (Railway)

This guide deploys Shopfront to Railway with managed PostgreSQL + Redis, custom domain, SSL, and CI/CD from GitHub Actions.

## 1. Prerequisites

- Railway account
- GitHub repo connected (`main` branch)
- Twilio account with SMS/WhatsApp senders configured
- Domain name (for example `shopfront.page`)

## 2. Create Railway Project

1. In Railway, create a new project from this GitHub repository.
2. Add services:
   - `shopfront` (Dockerfile deploy)
   - `PostgreSQL`
   - `Redis`
3. In the `shopfront` service, set start command:
   - `node dist/index.js`

## 3. Configure Environment Variables

Set these in the Railway `shopfront` service:

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL` (from Railway Postgres connection string)
- `REDIS_URL` (from Railway Redis connection string)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_NUMBER`
- `TWILIO_WHATSAPP_NUMBER`
- `ANTHROPIC_API_KEY`
- `BASE_URL=https://shopfront.page`
- `SKIP_TWILIO_VALIDATION=false`
- `SKIP_TWILIO_SEND=false`
- `MOCK_ANTHROPIC=false`

## 4. Run Database Migrations

From Railway shell or local CLI connected to the project:

```bash
npx prisma migrate deploy
```

Optional seed:

```bash
npm run prisma:seed
```

## 5. Custom Domain + SSL

1. In Railway, open the `shopfront` service settings, add custom domain `shopfront.page` (or your chosen domain).
2. Add DNS records requested by Railway (usually CNAME/ALIAS).
3. Wait for certificate issuance (Railway provisions SSL automatically).
4. Confirm:

```bash
curl -i https://shopfront.page/health
```

## 6. Twilio Webhook Configuration

In Twilio Console:

- SMS webhook URL: `https://shopfront.page/api/webhook/sms`
- WhatsApp webhook URL: `https://shopfront.page/api/webhook/whatsapp`
- HTTP method: `POST`

Then send a test message and confirm logs/events in Railway.

## 7. GitHub Actions CI/CD

Workflow file: `.github/workflows/deploy.yml`

Pipeline on push to `main`:
1. Lint
2. Test (with PostgreSQL + Redis service containers)
3. Build
4. Deploy to Railway

Required GitHub secrets:

- `RAILWAY_TOKEN`
- `RAILWAY_SERVICE` (target Railway service name)

## 8. Operational Checks

After deployment verify:

- `GET /health`
- `GET /metrics`
- `GET /s/:slug` for a known shop
- Twilio inbound webhook receives and responds
- Site updates after data mutations (message -> DB update -> rebuilt page)

## 9. Local Production Smoke Test

Use the production compose stack:

```bash
docker compose -f docker-compose.prod.yml up --build
```

Then check:

```bash
curl -i http://localhost:3000/health
curl -i http://localhost:3000/metrics
```
