export type ProxyIdentity = { userId: string; email: string; displayName: string; fullName: string | null };
type ProxyConfig = { AUTH_MODE?: string; PROXY_ASSERTION_SECRET?: string; PROXY_ASSERTION_ISSUER?: string; PROXY_ASSERTION_AUDIENCE?: string };
const bytes = new TextEncoder();
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid encoding');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export async function verifyProxyAssertion(token: unknown, cfg: ProxyConfig, now = Date.now()): Promise<ProxyIdentity | null> {
  if (cfg.AUTH_MODE !== 'trusted-proxy' || !cfg.PROXY_ASSERTION_SECRET || cfg.PROXY_ASSERTION_SECRET.length < 32 || !cfg.PROXY_ASSERTION_ISSUER || !cfg.PROXY_ASSERTION_AUDIENCE || typeof token !== 'string' || token.length > 4096) return null;
  try {
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const head = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (head.alg !== 'HS256' || head.typ !== 'JWT') return null;
    const key = await crypto.subtle.importKey('raw', bytes.encode(cfg.PROXY_ASSERTION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, decode(parts[2]) as Uint8Array<ArrayBuffer>, bytes.encode(`${parts[0]}.${parts[1]}`))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const seconds = Math.floor(now / 1000);
    if (claims.iss !== cfg.PROXY_ASSERTION_ISSUER || claims.aud !== cfg.PROXY_ASSERTION_AUDIENCE || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > seconds + 5 || claims.iat < seconds - 60 || claims.exp <= seconds || claims.exp <= claims.iat || claims.exp - claims.iat > 60) return null;
    if (typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 150 || claims.sub.startsWith('demo_') || typeof claims.email !== 'string' || !claims.email.trim() || claims.email.length > 254 || (claims.name !== undefined && (typeof claims.name !== 'string' || claims.name.length > 150))) return null;
    const fullName = claims.name?.trim() || null;
    return { userId: claims.sub, email: claims.email, fullName, displayName: fullName ?? claims.email };
  } catch { return null; }
}
