import { env } from "cloudflare:workers";
import { DomainError } from "./domain-error";

type StorageEnv = { SUPABASE_URL?: string; SUPABASE_SERVICE_KEY?: string };
const config = () => env as unknown as StorageEnv;
export const storageConfigured = () => Boolean(config().SUPABASE_URL && config().SUPABASE_SERVICE_KEY);
const path = (key: string) => key.split('/').map(encodeURIComponent).join('/');
async function request(endpoint: string, init: RequestInit = {}): Promise<Response> {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: secret } = config();
  if (!url || !secret || !/^https:\/\/[^/]+\.supabase\.co$/.test(url)) throw new DomainError("图片存储暂未配置", 503);
  const headers = new Headers(init.headers);
  headers.set('apikey', secret);

  let response: Response;
  try { response = await fetch(`${url}/storage/v1/${endpoint}`, { ...init, headers }); }
  catch { throw new DomainError('图片存储连接失败，请稍后重试', 503); }
  if (!response.ok && response.status !== 404) throw new DomainError('图片存储暂不可用，请稍后重试', 503);
  return response;
}
export const imageStorage = {
  async put(key: string, bytes: Uint8Array, contentType: string, metadata: Record<string, string>) {
    const encoded = btoa(JSON.stringify(metadata));
    const response = await request(`object/student-images/${path(key)}`, { method: 'POST', headers: { 'content-type': contentType, 'x-metadata': encoded, 'x-upsert': 'false', 'cache-control': 'no-store' }, body: bytes as unknown as BodyInit });
    if (!response.ok) throw new DomainError('图片上传失败，请稍后重试', 503);
  },
  async get(key: string): Promise<Response | null> {
    const response = await request(`object/student-images/${path(key)}`, { headers: { 'cache-control': 'no-cache' } });
    return response.status === 404 ? null : response;
  },
  async metadata(key: string): Promise<Record<string, string> | undefined> {
    const response = await request(`object/info/student-images/${path(key)}`);
    if (response.status === 404) return undefined;
    const info = await response.json() as { metadata?: Record<string, string> };
    return info.metadata;
  },
  async delete(key: string) {
    await request('object/student-images', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) });
  },
  async list(prefix: string, cursor?: string) {
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new DomainError('图片回收游标无效', 503);
    const response = await request('object/list/student-images', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefix: prefix.replace(/\/$/, ''), limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }) });
    if (!response.ok) throw new DomainError('图片回收扫描失败', 503);
    const entries = await response.json() as Array<{ name: string; id?: string | null; user_metadata?: Record<string, string> }>;
    if (entries.length === 1000) throw new DomainError("图片回收范围过大，请联系管理员", 503); return { objects: entries.filter(item => item.id).map(item => ({ key: prefix + item.name, customMetadata: item.user_metadata })), truncated: false };
  },
};



