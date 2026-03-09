const DEFAULT_FROM = '+14156871788';
const DEFAULT_TO = '+15557654321';
const DEFAULT_BODY = 'Hi from personal phone test';

interface CliOptions {
  from: string;
  to: string;
  body: string;
  channel: 'sms' | 'whatsapp';
  baseUrl: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      continue;
    }

    options[key] = value;
    i += 1;
  }

  const channel = options.channel === 'whatsapp' ? 'whatsapp' : 'sms';

  return {
    from: options.from ?? process.env.TEST_FROM ?? DEFAULT_FROM,
    to: options.to ?? process.env.TEST_TO ?? DEFAULT_TO,
    body: options.body ?? process.env.TEST_BODY ?? DEFAULT_BODY,
    channel,
    baseUrl: options.baseUrl ?? process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const path = args.channel === 'whatsapp' ? '/api/webhook/whatsapp' : '/api/webhook/sms';
  const webhookUrl = `${args.baseUrl.replace(/\/$/, '')}${path}`;

  const payload = new URLSearchParams({
    MessageSid: `SM_SIM_${Date.now()}`,
    From: args.channel === 'whatsapp' ? `whatsapp:${args.from}` : args.from,
    To: args.channel === 'whatsapp' ? `whatsapp:${args.to}` : args.to,
    Body: args.body,
    NumMedia: '0',
  });

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  });

  const body = await response.text();

  console.log('Webhook URL:', webhookUrl);
  console.log('From:', args.from);
  console.log('Channel:', args.channel);
  console.log('Status:', response.status);
  console.log('Body:', body);
}

main().catch((error) => {
  console.error('Personal phone webhook test failed:', error);
  process.exit(1);
});
