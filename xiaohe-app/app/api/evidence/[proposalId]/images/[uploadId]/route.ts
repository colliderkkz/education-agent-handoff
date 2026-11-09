import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { getDb } from "../../../../../../db";
import { uploadedFiles } from "../../../../../../db/schema";
import { assertSameOrigin, errorResponse, json, requestWorkspaceId } from "../../../../../../lib/server/http";
import { resolveAccess } from "../../../../../../lib/server/memberships";
import { readWorkspace } from "../../../../../../lib/server/store";
import { availableReviewImage } from "../../../../../../lib/server/file-access";

/** A review grants access only to images explicitly selected for this proposal. */
export async function GET(request: Request, context: { params: Promise<{ proposalId: string; uploadId: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const user = await getChatGPTUser();
    if (!user) return json({ error: "请先使用 ChatGPT 登录" }, 401);
    const selectedWorkspace = requestWorkspaceId(request);
    const { proposalId, uploadId } = await context.params;
    const missing = () => json({ error: "原稿不存在或无权查看" }, 404);
    if (![proposalId, uploadId].every(id => typeof id === "string" && id.length > 0 && id.length <= 200 && !/[\s/\\\x00-\x1f]/.test(id))) return missing();
    const file = await getDb().select().from(uploadedFiles).where(eq(uploadedFiles.id, uploadId)).get();
    if (!file || !env.BUCKET || (selectedWorkspace && selectedWorkspace !== file.userId)) return missing();
    const access = await resolveAccess(user, file.userId).catch(() => null);
    if (!access || !["owner", "student", "teacher"].includes(access.role)) return missing();
    const state = await readWorkspace(user, access);
    if (!availableReviewImage(state, proposalId, uploadId, user.userId, access.role)) return missing();
    const object = await env.BUCKET.get(file.objectKey);
    if (!object) return missing();
    // Recheck after storage I/O: revoked or changed membership cannot use a
    // previously authorized fetch to receive the original image.
    const current = await readWorkspace(user, access).catch(() => null);
    if (!current || !availableReviewImage(current, proposalId, uploadId, user.userId, access.role)) return missing();
    return new Response(object.body, { headers: {
      "Content-Type": file.mediaType,
      "Content-Length": String(file.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    } });
  } catch (error) { return errorResponse(error); }
}
