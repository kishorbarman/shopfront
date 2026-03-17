import assert from 'node:assert/strict';
import test from 'node:test';

process.env.MOCK_LLM = 'true';

import { extractMutationEntities } from '../src/agent/extractors';

const context = {
  shopName: "Tony's Barbershop",
  services: ['Haircut', 'Fade', 'Beard Trim', 'Hot Towel Shave'],
  notices: [
    { id: '11111111-1111-1111-1111-111111111111', message: 'Closed Monday' },
    { id: '22222222-2222-2222-2222-222222222222', message: 'Cash only' },
  ],
};

test('extract add_service', async () => {
  const result = await extractMutationEntities('add_service', 'Add lineup for $10', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.name, 'Lineup');
    assert.equal(result.data.price, 10);
  }
});

test('extract add_service from compact price-tag format', async () => {
  const result = await extractMutationEntities('add_service', 'HairColor:$30', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.name, 'HairColor');
    assert.equal(result.data.price, 30);
  }
});


test('extract add_service for multiple services in one message', async () => {
  const result = await extractMutationEntities(
    'add_service',
    'Haircolor $30, Mens haircut $40, Womens haircut $50',
    context,
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(Array.isArray(result.data.services));
    assert.equal(result.data.services.length, 3);
    assert.deepEqual(
      result.data.services.map((service: { name: string; price: number }) => ({
        name: service.name,
        price: service.price,
      })),
      [
        { name: 'Haircolor', price: 30 },
        { name: 'Mens Haircut', price: 40 },
        { name: 'Womens Haircut', price: 50 },
      ],
    );
  }
});

test('extract update_service with fuzzy service naming', async () => {
  const result = await extractMutationEntities('update_service', 'chg the fade to 35', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.serviceName, 'Fade');
    assert.equal(result.data.newPrice, 35);
  }
});

test('extract remove_service', async () => {
  const result = await extractMutationEntities('remove_service', 'remove hot towel', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.serviceName, 'Hot Towel Shave');
  }
});

test('extract update_hours', async () => {
  const result = await extractMutationEntities('update_hours', 'Open til 8 on Fridays', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(Array.isArray(result.data.changes));
    assert.ok(result.data.changes.length > 0);
  }
});

test('extract temp_closure', async () => {
  const result = await extractMutationEntities('temp_closure', 'Closed next Monday', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(result.data.message);
    assert.ok(result.data.startsAt);
    assert.ok(result.data.expiresAt);
  }
});

test('extract update_contact', async () => {
  const result = await extractMutationEntities('update_contact', 'New number is 555-123-4567', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.field, 'phone');
  }
});

test('extract update_contact address strips leading is', async () => {
  const result = await extractMutationEntities('update_contact', 'Our address is 123 Main Street, Springfield', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.field, 'address');
    assert.equal(result.data.value, '123 Main Street, Springfield');
  }
});

test('extract add_notice', async () => {
  const result = await extractMutationEntities('add_notice', 'Put up a sign: cash only today', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.match(result.data.message, /cash only/i);
  }
});

test('extract remove_notice', async () => {
  const result = await extractMutationEntities('remove_notice', 'Remove that sign now', context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(result.data.noticeId);
  }
});

test('extract update_photo with media', async () => {
  const result = await extractMutationEntities('update_photo', 'Make this my main photo', {
    ...context,
    hasMedia: true,
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.useAsMain, true);
  }
});
