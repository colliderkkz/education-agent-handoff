import { getChatGPTUser } from "../../chatgpt-auth";
import { applyAction, DomainError } from "../../../lib/server/domain";
import { changeWorkspace, readWorkspace } from "../../../lib/server/store";
import { assertSameOrigin, errorResponse, json, readLimitedBody, requestWorkspaceId } from "../../../lib/server/http";
import { resolveAccess } from "../../../lib/server/memberships";
import { projectWorkspace } from "../../../lib/server/access-policy";
import { retryHistoryFiles } from "../../../lib/server/history-file-gc";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "请先使用 ChatGPT 登录" }, 401);
    const access = await resolveAccess(user, requestWorkspaceId(request));
    return json({ state: projectWorkspace(await readWorkspace(user, access), access.role) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "请先使用 ChatGPT 登录" }, 401);
    assertSameOrigin(request);
    const text = new TextDecoder().decode(await readLimitedBody(request, 150_000));
    const action = JSON.parse(text);
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new DomainError("请求格式不正确");
    const access = await resolveAccess(user, requestWorkspaceId(request, action));
    // Workspace selection belongs to this authorized transport boundary, not the domain command.
    const command = { ...action };
    delete command.workspaceId;
    if (command.action === "history.files.retry") {
      if (Object.keys(command).some(key => key !== "action")) throw new DomainError("文件回收不接受额外参数");
      const { state, pendingUploads } = await retryHistoryFiles(user, access);
      const pending = state.historyDeletion?.fileTasks.filter(task => task.status === "pending").length ?? 0;
      return json({ state: projectWorkspace(state, access.role), result: { pendingUploads, message: pending || pendingUploads ? `已撤销图片访问，仍有 ${pending + pendingUploads} 个文件等待回收，可重试` : "已处理所选图片和当前可确认归属的暂存上传" } });
    }
    const result = await changeWorkspace(user, state => applyAction(state, command, { ...user, role: access.role }), access);
    if (command.action === "history.delete.confirm") {
      const { state, pendingUploads } = await retryHistoryFiles(user, access);
      const pending = state.historyDeletion?.fileTasks.filter(task => task.status === "pending").length ?? 0;
      return json({ ...result, state: projectWorkspace(state, access.role), result: { ...result.result, pendingUploads, message: pending || pendingUploads ? `学习记录已删除；${pending + pendingUploads} 个图片文件已撤销访问，等待回收` : "所选学习记录已删除，已选图片回收完成" } });
    }
    return json({ ...result, state: projectWorkspace(result.state, access.role) });
  } catch (error) { return errorResponse(error); }
}
