import assert from 'node:assert/strict';
import test from 'node:test';

process.env.MOCK_LLM = 'true';

import { parseHours, parseServices } from '../src/agent/parsers';

test('parseServices handles word-based prices', async () => {
  const result = await parseServices('haircut twenty five');

  assert.ok(result);
  assert.equal(result?.length, 1);
  assert.equal(result?.[0]?.name, 'Haircut');
  assert.equal(result?.[0]?.price, 25);
});

test('parseServices handles mixed messy service phrasing', async () => {
  const result = await parseServices('lineup ten and shave twenty');

  assert.ok(result);
  assert.equal(result?.length, 2);
  assert.deepEqual(result?.map((item) => item.name), ['Lineup', 'Shave']);
  assert.deepEqual(result?.map((item) => item.price), [10, 20]);
});

test('parseHours handles mon thru fri 9-6', async () => {
  const result = await parseHours('mon thru fri 9-6');

  assert.ok(result);
  assert.equal(result?.length, 7);

  const weekdays = result?.filter((hour) => hour.dayOfWeek >= 1 && hour.dayOfWeek <= 5) ?? [];
  assert.equal(weekdays.length, 5);
  assert.ok(weekdays.every((hour) => hour.isClosed === false));
  assert.ok(weekdays.every((hour) => hour.open === '09:00' && hour.close === '18:00'));
});
