const webhookUrl = 'http://localhost:3000/api/webhook/sms';

const payload = new URLSearchParams({
  MessageSid: 'SM1234567890abcdef',
  From: '+15551230001',
  To: '+15557654321',
  Body: 'Test message from webhook script',
  NumMedia: '0',
});

async function main() {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  });

  const body = await response.text();

  console.log('Status:', response.status);
  console.log('Headers:', Object.fromEntries(response.headers.entries()));
  console.log('Body:', body);
}

main().catch((error) => {
  console.error('Webhook test failed:', error);
  process.exit(1);
});
