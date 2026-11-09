import { and, eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../db";
import { workspaces } from "../../db/schema";
import { createSeedWorkspace } from "../seed";
import type { ApiResult, WorkspaceState } from "../types";
import type { ChatGPTUser } from "../../app/chatgpt-auth";
import { DomainError } from "./domain";
import { listAccessibleWorkspaces, resolveAccess } from "./memberships";
import type { AccessContext } from "../access-types";

async function checkedAccess(user: ChatGPTUser, requested?: AccessContext): Promise<AccessContext> {
  const current = await resolveAccess(user, requested?.workspaceId);
  if (requested && (requested.ownerId !== current.ownerId || requested.role !== current.role)) throw new DomainError("学习空间授权已发生变化，请刷新后重试", 403);
  return current;
}

function authorizedOwnerPredicate(user: ChatGPTUser, access: AccessContext) {
  const owner = eq(workspaces.userId, access.ownerId);
  if (access.role === "owner") return owner;
  return and(owner, sql`EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = ${access.ownerId} AND m.user_id = ${user.userId} AND m.status = 'active' AND m.role = ${access.role})`);
}

export async function readWorkspace(user: ChatGPTUser, requested?: AccessContext): Promise<WorkspaceState> {
  const access = await checkedAccess(user, requested);
  const db = getDb();
  let row = await db.select().from(workspaces).where(authorizedOwnerPredicate(user, access)).get();
  if (!row) {
    if (access.role !== "owner") throw new DomainError("无权访问此学习空间，或授权已撤销", 403);
    const now = new Date().toISOString();
    const state = createSeedWorkspace(user.userId, user.displayName, now);
    await db.insert(workspaces).values({ userId: user.userId, revision: 0, state: JSON.stringify(state), createdAt: now, updatedAt: now }).onConflictDoNothing();
    row = await db.select().from(workspaces).where(eq(workspaces.userId, user.userId)).get();
  }
  if (!row) throw new Error("Workspace initialization failed");
  const state = JSON.parse(row.state) as WorkspaceState;
  state.revision = row.revision;
  state.actor = { id: user.userId, name: user.displayName, role: access.role };
  const accessible = await listAccessibleWorkspaces(user);
  if (!accessible.some(workspace => workspace.id === access.workspaceId && workspace.role === access.role)) throw new DomainError("学习空间授权已发生变化，请刷新后重试", 403);
  state.access = { ...access, workspaces: accessible };
  state.capabilities = { ocr: false, ai: false, speech: false, storage: Boolean(env.BUCKET) };
  return state;
}

/** Compare-and-swap avoids overwriting a concurrent help event, submission or upload. */
export async function changeWorkspace(user: ChatGPTUser, change: (state: WorkspaceState) => ApiResult, requested?: AccessContext): Promise<ApiResult> {
  for (let retry = 0; retry < 6; retry++) {
    const access = await checkedAccess(user, requested);
    const current = await readWorkspace(user, access);
    // Capture before invoking a callback; in-place array changes must never move
    // the CAS baseline or cause an upload to be silently treated as a no-op.
    const baseRevision = current.revision;
    const result = change(current);
    if (result.state.revision === baseRevision) return result;
    if (result.state.revision !== baseRevision + 1) throw new Error("Workspace change must advance revision exactly once");
    // Viewer roles and the list of accessible spaces are request-scoped, never
    // persisted as shared profile data. Audit actors remain on their own events.
    const stored = { ...result.state, actor: { id: access.ownerId, name: "空间所有者", role: "owner" as const } };
    delete stored.access;
    const serialized = JSON.stringify(stored);
    if (serialized.length > 4_000_000) throw new DomainError("当前试点工作区已达到容量上限，请联系管理员导出归档。", 413);
    const changed = await getDb().update(workspaces).set({ state: serialized, revision: result.state.revision, updatedAt: new Date().toISOString() }).where(and(authorizedOwnerPredicate(user, access), eq(workspaces.revision, baseRevision))).returning({ userId: workspaces.userId });
    if (changed.length) return result;
  }
  throw new DomainError("当前有其他操作正在保存，请稍后重试。你的已保存记录不会丢失。", 409);
}
