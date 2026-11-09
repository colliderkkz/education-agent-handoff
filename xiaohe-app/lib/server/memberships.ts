import type { ChatGPTUser } from "../../app/chatgpt-auth";
import type { Role } from "../types";
import type { AccessContext, AccessOverview, AccessApiResult, InviteSummary, MemberSummary, WorkspaceSummary } from "../access-types";
import { DomainError } from "./domain.ts";
import { createSeedWorkspace } from "../seed.ts";

type Database = Pick<D1Database, "prepare" | "batch">;
type MemberRow = { id: string; workspace_id: string; user_id: string; email: string; name: string; role: Exclude<Role, "owner">; status: "active" | "revoked"; created_at: string; revoked_at: string | null };
type InviteRow = { id: string; workspace_id: string; role: Exclude<Role, "owner">; email: string; label: string; status: "pending" | "accepted" | "revoked"; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };
const inviteRoles = new Set(["student", "parent", "teacher", "editor", "reviewer"]);
const SEVEN_DAYS = 7 * 86400000;

async function database(provided?: Database): Promise<Database> {
  if (provided) return provided;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new DomainError("成员服务暂时不可用", 503);
  return env.DB;
}
function denied(): never { throw new DomainError("无权访问此学习空间，或授权已撤销", 403); }
function text(value: unknown, label: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) throw new DomainError(`${label}格式不正确`);
  return value.trim();
}
export function normalizeEmail(value: unknown): string {
  const normalized = text(value, "邮箱", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new DomainError("请输入有效邮箱");
  return normalized;
}
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
function invitedRole(value: unknown): Exclude<Role, "owner"> {
  if (typeof value !== "string" || !inviteRoles.has(value)) throw new DomainError("请选择学生、家长、教师、编辑或审核人角色");
  return value as Exclude<Role, "owner">;
}

export async function resolveAccess(user: ChatGPTUser, workspaceId?: string, provided?: Database): Promise<AccessContext> {
  const target = workspaceId ? text(workspaceId, "学习空间", 200) : user.userId;
  if (target === user.userId) return { workspaceId: target, ownerId: target, role: "owner" };
  const db = await database(provided);
  const member = await db.prepare("SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? AND status = 'active'").bind(target, user.userId).first<{ role: Role }>();
  if (!member) denied();
  return { workspaceId: target, ownerId: target, role: member.role };
}

export async function listAccessibleWorkspaces(user: ChatGPTUser, provided?: Database): Promise<WorkspaceSummary[]> {
  const db = await database(provided);
  const own = await db.prepare("SELECT json_extract(state, '$.profile.name') AS name FROM workspaces WHERE user_id = ?").bind(user.userId).first<{ name: string | null }>();
  const shared = await db.prepare("SELECT m.workspace_id AS id, m.role AS role, json_extract(w.state, '$.profile.name') AS name FROM workspace_memberships m JOIN workspaces w ON w.user_id = m.workspace_id WHERE m.user_id = ? AND m.status = 'active' ORDER BY m.created_at, m.id").bind(user.userId).all<{ id: string; role: Role; name: string | null }>();
  return [
    { id: user.userId, name: own?.name ? `${own.name}的学习空间` : "我的学习空间", role: "owner" },
    ...shared.results.map(row => ({ id: row.id, name: row.role === "editor" || row.role === "reviewer" ? "已授权的教研空间" : row.name ? `${row.name}的学习空间` : "已授权的学习空间", role: row.role })),
  ];
}

export async function getAccessOverview(user: ChatGPTUser, workspaceId?: string, provided?: Database): Promise<AccessOverview> {
  const db = await database(provided);
  const access = await resolveAccess(user, workspaceId, db);
  const workspaces = await listAccessibleWorkspaces(user, db);
  const current = workspaces.find(workspace => workspace.id === access.workspaceId);
  if (!current) denied();
  if (access.role !== "owner") return { current, workspaces, members: [], invites: [] };
  const memberRows = await db.prepare("SELECT id, user_id, email, name, role, status, created_at, revoked_at FROM workspace_memberships WHERE workspace_id = ? ORDER BY created_at DESC, id").bind(access.ownerId).all<MemberRow>();
  const inviteRows = await db.prepare("SELECT id, role, email, label, status, created_at, expires_at, accepted_at, revoked_at FROM workspace_invites WHERE workspace_id = ? ORDER BY created_at DESC, id").bind(access.ownerId).all<InviteRow>();
  const members: MemberSummary[] = memberRows.results.map(row => ({ id: row.id, userId: row.user_id, name: row.name, email: row.email, role: row.role, status: row.status, createdAt: row.created_at, ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}) }));
  const invites: InviteSummary[] = inviteRows.results.map(row => ({ id: row.id, role: row.role, email: row.email, label: row.label, status: row.status, createdAt: row.created_at, expiresAt: row.expires_at, ...(row.accepted_at ? { acceptedAt: row.accepted_at } : {}), ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}) }));
  return { current, workspaces, members, invites };
}

async function ensureOwnWorkspace(user: ChatGPTUser, db: Database, now: string): Promise<void> {
  const seed = createSeedWorkspace(user.userId, user.displayName, now);
  await db.prepare("INSERT INTO workspaces (user_id, revision, state, created_at, updated_at) VALUES (?, 0, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING").bind(user.userId, JSON.stringify(seed), now, now).run();
}

export async function changeAccess(user: ChatGPTUser, value: unknown, provided?: Database, now = new Date().toISOString()): Promise<AccessApiResult> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("成员请求格式不正确");
  const input = value as Record<string, unknown>;
  const action = text(input.action, "操作", 50);
  const db = await database(provided);
  if (action === "invite.accept") {
    const token = text(input.token, "邀请凭证", 200);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new DomainError("邀请无效、已使用或已过期", 409);
    const hash = await hashInviteToken(token);
    const claimId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const email = normalizeEmail(user.email);
    // Both statements run in one D1 transaction. A unique claim prevents replay
    // even when two requests share an identical timestamp. Role/student guards
    // are inside the write, so acceptance cannot race another acceptance/revoke.
    const claimed = await db.batch([
      db.prepare(`UPDATE workspace_invites SET status = 'accepted', accepted_at = CASE WHEN created_at > ? THEN created_at ELSE ? END, accepted_by = ?, acceptance_id = ?
        WHERE token_hash = ? AND status = 'pending' AND expires_at > ? AND email = ? AND workspace_id <> ?
          AND NOT EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = workspace_invites.workspace_id AND m.status = 'active' AND (m.user_id = ? OR m.email = ?))
          AND NOT EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = workspace_invites.workspace_id AND (m.user_id = ? OR m.email = ?) AND m.revoked_at IS NOT NULL AND m.revoked_at >= workspace_invites.created_at)
          AND (role <> 'student' OR NOT EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = workspace_invites.workspace_id AND m.role = 'student' AND m.status = 'active'))`).bind(now, now, user.userId, claimId, hash, now, email, user.userId, user.userId, email, user.userId, email),
      db.prepare(`INSERT INTO workspace_memberships (id, workspace_id, user_id, email, name, role, status, created_at, revoked_at)
        SELECT ?, workspace_id, ?, email, ?, role, 'active', accepted_at, NULL FROM workspace_invites WHERE acceptance_id = ? AND status = 'accepted'
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET email = excluded.email, name = excluded.name, role = excluded.role, status = 'active', created_at = excluded.created_at, revoked_at = NULL
        WHERE workspace_memberships.status = 'revoked'`).bind(memberId, user.userId, user.displayName, claimId),
    ]);
    if (claimed[0].meta.changes !== 1 || claimed[1].meta.changes !== 1) throw new DomainError("邀请无效、邮箱不匹配、已使用、已过期，或该学习空间已有对应成员。", 409);
    const accepted = await db.prepare("SELECT workspace_id FROM workspace_invites WHERE acceptance_id = ?").bind(claimId).first<{ workspace_id: string }>();
    if (!accepted) throw new DomainError("邀请接收状态暂时不可用，请刷新查看已授权空间", 503);
    return { overview: await getAccessOverview(user, accepted.workspace_id, db), result: { id: accepted.workspace_id, message: "邀请已接受，可以进入已授权的学习空间" } };
  }
  if (!["invite.create", "invite.revoke", "member.revoke"].includes(action)) throw new DomainError("不支持的成员操作");
  const workspaceId = input.workspaceId === undefined ? user.userId : text(input.workspaceId, "学习空间", 200);
  const access = await resolveAccess(user, workspaceId, db);
  if (access.role !== "owner") denied();
  await ensureOwnWorkspace(user, db, now);
  if (action === "invite.create") {
    const role = invitedRole(input.role);
    const email = normalizeEmail(input.email);
    if (email === normalizeEmail(user.email)) throw new DomainError("不能邀请当前空间所有者自己");
    const label = text(input.label, "备注", 100, true);
    const existing = await db.prepare("SELECT id, status, revoked_at FROM workspace_memberships WHERE workspace_id = ? AND email = ? ORDER BY created_at DESC LIMIT 1").bind(access.ownerId, email).first<{ id: string; status: string; revoked_at: string | null }>();
    if (existing?.status === "active") throw new DomainError("该邮箱已经有有效授权，请先撤销旧授权再更换角色", 409);
    if (role === "student") {
      const student = await db.prepare("SELECT id FROM workspace_memberships WHERE workspace_id = ? AND role = 'student' AND status = 'active'").bind(access.ownerId).first();
      if (student) throw new DomainError("每个学习档案最多绑定一位学生，请先撤销原学生授权", 409);
    }
    const token = newToken();
    const id = crypto.randomUUID();
    // Advance past the last revocation even when consecutive requests land in
    // the same millisecond. The conditional INSERT rejects a delayed request
    // whose authorization snapshot became stale while its token was prepared.
    const createdAt = new Date(Math.max(Date.parse(now), existing?.revoked_at ? Date.parse(existing.revoked_at) + 1 : 0)).toISOString();
    const inserted = await db.prepare(`INSERT INTO workspace_invites (id, workspace_id, token_hash, role, email, label, status, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = ? AND m.email = ? AND (m.status = 'active' OR m.revoked_at >= ?))`).bind(id, access.ownerId, await hashInviteToken(token), role, email, label, createdAt, new Date(Date.parse(createdAt) + SEVEN_DAYS).toISOString(), access.ownerId, email, createdAt).run();
    if (inserted.meta.changes !== 1) throw new DomainError("该邮箱的授权状态刚刚发生变化，请刷新后重新创建邀请", 409);
    return { overview: await getAccessOverview(user, access.ownerId, db), result: { id, token, message: "邀请已创建，有效期 7 天。凭证仅显示一次，请自行发送给指定邮箱本人。" } };
  }
  const id = text(input.id, "授权记录", 200);
  const revoked = action === "invite.revoke"
    ? await db.prepare("UPDATE workspace_invites SET status = 'revoked', revoked_at = CASE WHEN created_at > ? THEN created_at ELSE ? END WHERE id = ? AND workspace_id = ? AND status = 'pending'").bind(now, now, id, access.ownerId).run()
    : (await db.batch([
      db.prepare("UPDATE workspace_memberships SET status = 'revoked', revoked_at = CASE WHEN created_at > ? THEN created_at ELSE ? END WHERE id = ? AND workspace_id = ? AND status = 'active'").bind(now, now, id, access.ownerId),
      // changes() observes only the immediately preceding statement in this
      // transaction: repeating an already-completed revoke cannot cancel a
      // freshly issued invitation. A successful revoke invalidates all older
      // outstanding credentials for this bound mailbox atomically.
      db.prepare(`UPDATE workspace_invites SET status = 'revoked', revoked_at = (SELECT revoked_at FROM workspace_memberships WHERE id = ? AND workspace_id = ?)
        WHERE changes() = 1 AND workspace_id = ? AND status = 'pending'
          AND email = (SELECT email FROM workspace_memberships WHERE id = ? AND workspace_id = ? AND status = 'revoked')`).bind(id, access.ownerId, access.ownerId, id, access.ownerId),
    ]))[0];
  if (revoked.meta.changes !== 1) throw new DomainError(action === "invite.revoke" ? "邀请不存在、已撤销或已接受；已接受的邀请请在成员列表撤销授权" : "成员不存在或授权已经撤销", 409);
  return { overview: await getAccessOverview(user, access.ownerId, db), result: { id, message: action === "invite.revoke" ? "未使用的邀请已撤销" : "成员授权已撤销，已有学习记录保留" } };
}
