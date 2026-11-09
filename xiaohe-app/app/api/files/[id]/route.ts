import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { uploadedFiles } from "../../../../db/schema";
import { assertSameOrigin, errorResponse, json, requestWorkspaceId } from "../../../../lib/server/http";
import { resolveAccess } from "../../../../lib/server/memberships";
import { readWorkspace } from "../../../../lib/server/store";
import { availableUpload } from "../../../../lib/server/file-access";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const user = await getChatGPTUser();
    if (!user) return json({ error: "请先使用 ChatGPT 登录" }, 401);
    const { id } = await context.params;
    const selectedWorkspace = requestWorkspaceId(request);
    const file = await getDb().select().from(uploadedFiles).where(eq(uploadedFiles.id, id)).get();
    if (!file || !env.BUCKET || (selectedWorkspace && selectedWorkspace !== file.userId)) return json({ error: "图片不存在或无权查看" }, 404);
    const access = await resolveAccess(user, file.userId).catch(() => null);
    if (!access || !["owner", "student"].includes(access.role)) return json({ error: "图片不存在或无权查看" }, 404);
    const before = await readWorkspace(user, access).catch(() => null);
    if (!before || !availableUpload(before, id)) return json({ error: "图片不存在或无权查看" }, 404);
    const object = await env.BUCKET.get(file.objectKey);
    if (!object) return json({ error: "图片暂时不可用" }, 404);
    const after = await readWorkspace(user, access).catch(() => null);
    if (!after || !availableUpload(after, id)) return json({ error: "图片不存在或无权查看" }, 404);
    return new Response(object.body, { headers: { "Content-Type": file.mediaType, "Content-Length": String(file.size), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  } catch (error) { return errorResponse(error); }
}
