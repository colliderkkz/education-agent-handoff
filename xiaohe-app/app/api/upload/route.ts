import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { uploadedFiles } from "../../../db/schema";
import { changeWorkspace, readWorkspace } from "../../../lib/server/store";
import { DomainError } from "../../../lib/server/domain";
import { assertSameOrigin, errorResponse, json, readLimitedBody, requestWorkspaceId } from "../../../lib/server/http";
import { resolveAccess } from "../../../lib/server/memberships";
import { projectWorkspace } from "../../../lib/server/access-policy";


function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "请先使用 ChatGPT 登录" }, 401);
    assertSameOrigin(request);
    const access = await resolveAccess(user, requestWorkspaceId(request));
    if (access.role !== "owner" && access.role !== "student") throw new DomainError("当前角色不能上传或查看学习原图", 403);
    if (!env.BUCKET) throw new DomainError("文件存储暂未配置", 503);
    const body = await readLimitedBody(request, 11 * 1024 * 1024);
    let data: FormData;
    try { data = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); }
    catch { throw new DomainError("上传请求格式不正确，请重新选择图片"); }
    const file = data.get("file");
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) throw new DomainError("请选择 10 MB 以内的 JPG、PNG 或 WebP 图片");
    const purpose = data.get("purpose") === "single" ? "single" : "homework";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = imageType(bytes);
    if (!mediaType) throw new DomainError("仅支持有效的 JPG、PNG 或 WebP 图片，暂不支持 HEIC/PDF");
    const current = await readWorkspace(user, access);
    const startedDeletionEpoch = Math.max(0, ...(current.historyDeletion?.operations ?? []).map(operation => operation.appliedRevision));
    if (current.uploads.length >= 100) throw new DomainError("试点工作区最多保存 100 张图片，请联系管理员归档", 409);
    const id = crypto.randomUUID();
    const objectKey = `private/${encodeURIComponent(access.ownerId)}/${id}`;
    const filename = file.name.replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 150) || "作业图片";
    const now = new Date().toISOString();
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: mediaType }, customMetadata: { owner: access.ownerId, uploadId: id, historyEpoch: String(startedDeletionEpoch) } });
    try {
      // Keep this AFTER the awaited PUT. A GC-visible index is proof that this
      // request has finished writing the unique key, preventing late-PUT resurrection.
      await getDb().insert(uploadedFiles).values({ id, userId: access.ownerId, objectKey, filename, mediaType, size: file.size, purpose, historyEpoch: startedDeletionEpoch, createdAt: now });
      const result = await changeWorkspace(user, current => {
        if (Math.max(0, ...(current.historyDeletion?.operations ?? []).map(operation => operation.appliedRevision)) !== startedDeletionEpoch) throw new DomainError("上传期间学习历史发生删除；本次图片未登记，请重新选择上传", 409);
        const state = structuredClone(current);
        if (state.uploads.length >= 100) throw new DomainError("试点工作区最多保存 100 张图片", 409);
        state.uploads.unshift({ id, name: filename, url: `/api/files/${id}`, createdAt: now, status: "pending", purpose });
        state.events.unshift({ id: crypto.randomUUID(), action: "upload.create", label: "保存作业图片", actorId: user.userId, createdAt: now, detail: "已保存原图，等待逐题人工核对；未使用 OCR。" });
        return { state: { ...state, revision: state.revision + 1 }, result: { id, message: "图片已安全保存，请对照图片逐题核对" } };
      }, access);
      return json({ ...result, state: projectWorkspace(result.state, access.role) }, 201);
    } catch (error) {
      // A transport error after D1 committed is an unknown outcome. Read back
      // before compensation; never delete a file already referenced by a saved workspace.
      let recovered;
      try { recovered = await readWorkspace(user, access); } catch { /* Leave private staged objects for recovery when D1 is unavailable. */ }
      if (recovered?.uploads.some(upload => upload.id === id)) return json({ state: projectWorkspace(recovered, access.role), result: { id, message: "图片已保存并核实，请继续逐题核对" } }, 201);
      if (recovered) {
        try {
          await env.BUCKET.delete(objectKey);
          await getDb().delete(uploadedFiles).where(and(eq(uploadedFiles.id, id), eq(uploadedFiles.userId, access.ownerId)));
        } catch { /* Keep the server key indexed if object cleanup fails; a later history GC can retry it. */ }
      }
      throw error;
    }
  } catch (error) { return errorResponse(error); }
}
