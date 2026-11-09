import { getChatGPTUser } from "../../chatgpt-auth";
import { changeAccess, getAccessOverview } from "../../../lib/server/memberships";
import { assertSameOrigin, errorResponse, json, readLimitedBody, requestWorkspaceId } from "../../../lib/server/http";
import { DomainError } from "../../../lib/server/domain";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "请先使用 ChatGPT 登录" }, 401);
    const workspaceId = requestWorkspaceId(request);
    return json({ overview: await getAccessOverview(user, workspaceId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "请先使用 ChatGPT 登录" }, 401);
    assertSameOrigin(request);
    const input = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 10_000)));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new DomainError("成员请求格式不正确");
    const workspaceId = requestWorkspaceId(request, input);
    return json(await changeAccess(user, { ...input, workspaceId }));
  } catch (error) { return errorResponse(error); }
}
