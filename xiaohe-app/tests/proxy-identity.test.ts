import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyProxyAssertion } from '../lib/proxy-identity.ts';
const secret = 'unit-test-only-proxy-secret-over-32-bytes';
const cfg = { AUTH_MODE: 'trusted-proxy', PROXY_ASSERTION_SECRET: secret, PROXY_ASSERTION_ISSUER: 'issuer', PROXY_ASSERTION_AUDIENCE: 'audience' };
const now = 1800000000000, seconds = now / 1000;
function assertion(changes: Record<string, unknown> = {}, key = secret) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${part({ alg:'HS256', typ:'JWT' })}.${part({ sub:'user', email:'student@example.invalid', iss:'issuer', aud:'audience', iat:seconds, exp:seconds+60, ...changes })}`;
  return `${input}.${createHmac('sha256', key).update(input).digest('base64url')}`;
}
test('proxy requires a valid signed assertion bound to mode, issuer, audience and time', async () => {
  const token = assertion();
  assert.equal((await verifyProxyAssertion(token, cfg, now))?.userId, 'user');
  const untrustedRole = await verifyProxyAssertion(assertion({ role: 'owner' }), cfg, now);
  assert.equal(Object.hasOwn(untrustedRole!, 'role'), false);
  for (const candidate of [assertion({}, 'wrong-key'), assertion({ aud:'other' }), assertion({ iss:'other' }), assertion({ exp:seconds }), assertion({ iat:seconds-61 }), assertion({ exp:seconds+61 }), assertion({ sub:'demo_forged' }), `${token.slice(0,-1)}!`, 'user']) assert.equal(await verifyProxyAssertion(candidate, cfg, now), null);
  for (const mode of ['demo', 'disabled', '', undefined]) assert.equal(await verifyProxyAssertion(token, { ...cfg, AUTH_MODE:mode }, now), null);
  assert.equal(await verifyProxyAssertion(token, { ...cfg, PROXY_ASSERTION_SECRET:undefined }, now), null);
});
