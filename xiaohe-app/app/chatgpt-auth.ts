import { env } from "cloudflare:workers";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { demoIdentity } from "../lib/demo-identity";
import { verifyProxyAssertion } from "../lib/proxy-identity";

export type ChatGPTUser = { userId: string; displayName: string; email: string; fullName: string | null };
type AuthConfig = { AUTH_MODE?: string; DEMO_SESSION_SECRET?: string; PROXY_ASSERTION_SECRET?: string; PROXY_ASSERTION_ISSUER?: string; PROXY_ASSERTION_AUDIENCE?: string };
export function authMode(): 'demo' | 'trusted-proxy' | 'disabled' {
  const mode = (env as unknown as AuthConfig).AUTH_MODE;
  return mode === 'demo' || mode === 'trusted-proxy' ? mode : 'disabled';
}
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const config = env as unknown as AuthConfig;
  if (authMode() === 'demo') return demoIdentity((await cookies()).get('__Host-xiaohe_demo')?.value, config.DEMO_SESSION_SECRET ?? '');
  if (authMode() === 'trusted-proxy') return verifyProxyAssertion((await headers()).get('x-xiaohe-proxy-assertion'), config);
  return null;
}
export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser(); if (user) return user; redirect(chatGPTSignInPath(returnTo));
}
export function chatGPTSignInPath(returnTo: string): string {
  const path = safeRelativeReturnPath(returnTo); return authMode() === 'trusted-proxy' ? `/signin-with-chatgpt?return_to=${encodeURIComponent(path)}` : '/';
}
export function chatGPTSignOutPath(returnTo = '/'): string {
  return `/signout-with-chatgpt?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}
function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  try { const url = new URL(value, 'https://app.local'); if (url.origin !== 'https://app.local' || ['/signin-with-chatgpt','/signout-with-chatgpt','/callback'].includes(url.pathname)) return '/'; return `${url.pathname}${url.search}${url.hash}`; } catch { return '/'; }
}
