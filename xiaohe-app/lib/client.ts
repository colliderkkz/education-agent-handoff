import type { ApiResult } from "./types";
import type { AccessOverview } from "./access-types";

export function currentWorkspaceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("workspaceId")?.trim() || undefined;
}

export function workspaceUrl(path: string, workspaceId: string | null | undefined = currentWorkspaceId()): string {
  const url = new URL(path, typeof window === "undefined" ? "http://xiaohe.local" : window.location.origin);
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  else url.searchParams.delete("workspaceId");
  return `${url.pathname}${url.search}${url.hash}`;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const raw = await response.text();
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new ApiError(response.ok ? "服务返回了无法读取的数据，请重试" : "服务暂时无法连接，请稍后重试", response.status); }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "操作失败，请重试";
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export async function fetchWorkspace(): Promise<ApiResult> {
  return requestJson<ApiResult>(workspaceUrl("/api/workspace"));
}

export async function act(action: string, payload: Record<string, unknown> = {}): Promise<ApiResult> {
  const workspaceId = currentWorkspaceId();
  return requestJson<ApiResult>(workspaceUrl("/api/workspace", workspaceId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, action, workspaceId }) });
}

export interface AccessResult { overview: AccessOverview; result?: { id?: string; message?: string; token?: string } }
export async function fetchAccess(): Promise<AccessOverview> {
  return (await requestJson<{ overview: AccessOverview }>(workspaceUrl("/api/access"))).overview;
}
export async function actAccess(action: string, payload: Record<string, unknown> = {}): Promise<AccessResult> {
  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : currentWorkspaceId();
  return requestJson<AccessResult>(workspaceUrl("/api/access", workspaceId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, action, workspaceId }) });
}
