import { DomainError } from "./domain";

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function errorResponse(error: unknown): Response {
  if (error instanceof DomainError) return json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return json({ error: "请求内容不是有效 JSON" }, 400);
  console.error("Workspace operation failed", error instanceof Error ? error.message : "unknown error");
  return json({ error: "保存服务暂时不可用，请稍后重试。" }, 503);
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new DomainError("请从本站页面提交操作", 403);
}

/** Reject ambiguous selectors instead of silently writing a different dossier. */
export function requestWorkspaceId(request: Request, body?: Record<string, unknown>): string | undefined {
  const values = new URL(request.url).searchParams.getAll("workspaceId");
  if (values.length > 1) throw new DomainError("学习空间参数不能重复");
  const validate = (value: unknown): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim() || value.length > 200) throw new DomainError("学习空间参数格式不正确");
    return value.trim();
  };
  const query = validate(values[0]);
  const payload = validate(body?.workspaceId);
  if (query && payload && query !== payload) throw new DomainError("链接与请求中的学习空间不一致，请重新打开目标空间");
  return query ?? payload;
}

/** Bound streaming bodies before parsing, including requests without Content-Length. */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new DomainError("请求内容过大", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new DomainError("请求内容过大", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
