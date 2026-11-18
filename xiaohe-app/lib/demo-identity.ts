/** Server-issued, time-limited bearer session for the isolated demonstration. */
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function createDemoToken(secret: string, now = Date.now()): Promise<string> {
  if (!secret || secret.length < 32) throw new Error('Demo session secret is not configured');
  const payload = `${hex(crypto.getRandomValues(new Uint8Array(32)))}.${Math.floor(now / 1000) + 43200}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return `${payload}.${hex(new Uint8Array(signature))}`;
}
export async function demoIdentity(token: unknown, secret: string, now = Date.now()): Promise<{ userId: string; displayName: string; email: string; fullName: null } | null> {
  if (typeof token !== 'string' || !secret || secret.length < 32) return null;
  const match = /^([0-9a-f]{64})\.(\d{10})\.([0-9a-f]{64})$/.exec(token);
  if (!match || Number(match[2]) <= Math.floor(now / 1000) || Number(match[2]) > Math.floor(now / 1000) + 43200) return null;
  const signature = new Uint8Array(match[3].match(/../g)!.map(byte => parseInt(byte, 16)));
  if (!await crypto.subtle.verify('HMAC', await signingKey(secret), signature, encoder.encode(`${match[1]}.${match[2]}`))) return null;
  const id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(match[1]))));
  return { userId: `demo_${id}`, displayName: '演示访客', email: `demo-${id}@example.invalid`, fullName: null };
}
