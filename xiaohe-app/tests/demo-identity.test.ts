import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoToken, demoIdentity } from '../lib/demo-identity.ts';

const secret = 'test-only-secret-not-for-production-12345';
test('server-signed sessions are isolated, expire and reject forgery', async () => {
  const now = 1_800_000_000_000;
  const first = await createDemoToken(secret, now), second = await createDemoToken(secret, now);
  assert.notEqual(first, second);
  const identity = await demoIdentity(first, secret, now);
  assert.ok(identity?.userId.startsWith('demo_'));
  assert.deepEqual(await demoIdentity(first, secret, now), identity);
  assert.notDeepEqual(await demoIdentity(second, secret, now), identity);
  assert.equal(await demoIdentity(first, 'a-different-long-secret-1234567890', now), null);
  assert.equal(await demoIdentity(first, secret, now + 43200 * 1000), null);
  assert.equal(await demoIdentity(first.replace(/^./, first[0] === 'a' ? 'b' : 'a'), secret, now), null);
  assert.equal(await demoIdentity('0'.repeat(64), secret, now), null);
});
