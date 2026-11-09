import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { changeAccess, getAccessOverview, hashInviteToken, listAccessibleWorkspaces, resolveAccess } from "../lib/server/memberships.ts";
import { DomainError } from "../lib/server/domain.ts";
import type { ChatGPTUser } from "../app/chatgpt-auth";

const now = "2026-10-26T08:00:00.000Z";
const owner: ChatGPTUser = { userId: "owner-a", email: "owner@example.test", displayName: "档案所有者", fullName: "档案所有者" };
function user(id: string, email = `${id}@example.test`): ChatGPTUser { return { userId: id, email, displayName: id, fullName: id }; }
type Value = string | number | null | Uint8Array;

// Execute the actual generated migrations and production SQL against SQLite.
// The adapter supplies D1's transactional batch contract; no in-memory domain mock.
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of ["0000_great_wallop.sql", "0001_melodic_alex_power.sql"]) sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
  let failSecondBatchStatement = false;
  let beforeInviteInsert: (() => Promise<void>) | undefined;
  class Statement {
    sql: string;
    values: Value[];
    constructor(sql: string, values: Value[] = []) { this.sql = sql; this.values = values; }
    bind(...values: Value[]) { return new Statement(this.sql, values); }
    async first<T>(column?: string): Promise<T | null> {
      const row = sqlite.prepare(this.sql).get(...this.values);
      return row ? (column ? row[column] : row) as T : null;
    }
    async all<T>() { return { success: true, results: sqlite.prepare(this.sql).all(...this.values) as T[], meta: { changes: 0 } }; }
    execute() { const result = sqlite.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
    async run() {
      if (beforeInviteInsert && this.sql.startsWith("INSERT INTO workspace_invites")) {
        const hook = beforeInviteInsert; beforeInviteInsert = undefined;
        await hook();
      }
      return this.execute();
    }
  }
  const adapter = {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement, index) => {
          if (index === 1 && failSecondBatchStatement) { failSecondBatchStatement = false; throw new Error("Simulated second-statement failure"); }
          return statement.execute();
        });
        sqlite.exec("COMMIT"); return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, db: adapter as unknown as Pick<D1Database, "prepare" | "batch">, failNextBatch() { failSecondBatchStatement = true; }, beforeNextInviteInsert(hook: () => Promise<void>) { beforeInviteInsert = hook; } };
}
async function rejectsStatus(operation: Promise<unknown>, status: number) {
  await assert.rejects(operation, (error: unknown) => error instanceof DomainError && error.status === status);
}
async function invite(f: ReturnType<typeof fixture>, member: ChatGPTUser, role = "parent") {
  return changeAccess(owner, { action: "invite.create", workspaceId: owner.userId, email: member.email, role, label: "测试邀请" }, f.db, now);
}

test("unauthorized target IDs reveal neither workspace data nor member metadata", async () => {
  const f = fixture(); const stranger = user("stranger");
  await rejectsStatus(resolveAccess(stranger, owner.userId, f.db), 403);
  await rejectsStatus(getAccessOverview(stranger, "nonexistent-owner", f.db), 403);
  assert.deepEqual(await listAccessibleWorkspaces(stranger, f.db), [{ id: stranger.userId, name: "我的学习空间", role: "owner" }]);
  f.sqlite.close();
});

test("invite stores only a hash, binds a normalized email, and returns token only upon creation", async () => {
  const f = fixture(); const parent = user("parent-one", " Parent@One.Example.test ");
  const created = await invite(f, parent);
  const token = created.result!.token!;
  assert.match(token, /^[a-f0-9]{64}$/);
  const stored = f.sqlite.prepare("SELECT token_hash, email, expires_at FROM workspace_invites WHERE id = ?").get(created.result!.id!)!;
  assert.equal(stored.token_hash, await hashInviteToken(token));
  assert.equal(stored.email, "parent@one.example.test");
  assert.equal(stored.expires_at, "2026-11-02T08:00:00.000Z");
  assert.ok(!JSON.stringify(created.overview).includes(token));
  assert.ok(!JSON.stringify(await getAccessOverview(owner, undefined, f.db)).includes(String(stored.token_hash)));
  await rejectsStatus(changeAccess(user("wrong-email"), { action: "invite.accept", token }, f.db, now), 409);
  assert.equal(f.sqlite.prepare("SELECT status FROM workspace_invites").get()!.status, "pending");
  const accepted = await changeAccess(parent, { action: "invite.accept", token }, f.db, now);
  assert.equal(accepted.overview.current.role, "parent");
  assert.equal(accepted.overview.current.id, owner.userId);
  assert.deepEqual(accepted.overview.members, []);
  assert.deepEqual(accepted.overview.invites, []);
  await rejectsStatus(changeAccess(parent, { action: "invite.accept", token }, f.db, now), 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_memberships").get()!.count, 1);
  f.sqlite.close();
});

test("only owners create/revoke invitations and no self or owner-role grants are allowed", async () => {
  const f = fixture(); const parent = user("parent-two");
  await rejectsStatus(changeAccess(owner, { action: "invite.create", email: owner.email, role: "parent" }, f.db, now), 400);
  await rejectsStatus(changeAccess(owner, { action: "invite.create", email: parent.email, role: "owner" }, f.db, now), 400);
  const created = await invite(f, parent);
  await changeAccess(parent, { action: "invite.accept", token: created.result!.token }, f.db, now);
  await rejectsStatus(changeAccess(parent, { action: "invite.create", workspaceId: owner.userId, email: "third@example.test", role: "student" }, f.db, now), 403);
  await rejectsStatus(changeAccess(parent, { action: "member.revoke", workspaceId: owner.userId, id: "guessed-member" }, f.db, now), 403);
  await rejectsStatus(changeAccess(owner, { action: "invite.accept", token: created.result!.token }, f.db, now), 409);
  f.sqlite.close();
});

test("expiry and revoked invites cannot be accepted, including exact expiry boundary", async () => {
  const f = fixture(); const one = user("expiry"); const two = user("revoked");
  const expired = await invite(f, one);
  await rejectsStatus(changeAccess(one, { action: "invite.accept", token: expired.result!.token }, f.db, "2026-11-02T08:00:00.000Z"), 409);
  const revoked = await invite(f, two);
  await changeAccess(owner, { action: "invite.revoke", workspaceId: owner.userId, id: revoked.result!.id }, f.db, now);
  await rejectsStatus(changeAccess(two, { action: "invite.accept", token: revoked.result!.token }, f.db, now), 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_memberships").get()!.count, 0);
  f.sqlite.close();
});

test("simultaneous token acceptance creates exactly one active membership", async () => {
  const f = fixture(); const member = user("same-token"); const invitation = await invite(f, member, "reviewer");
  const results = await Promise.allSettled([
    changeAccess(member, { action: "invite.accept", token: invitation.result!.token }, f.db, now),
    changeAccess(member, { action: "invite.accept", token: invitation.result!.token }, f.db, now),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_memberships WHERE status='active'").get()!.count, 1);
  assert.equal((await resolveAccess(member, owner.userId, f.db)).role, "reviewer");
  f.sqlite.close();
});

test("two different student invites racing acceptance cannot merge students into one learning profile", async () => {
  const f = fixture(); const a = user("student-a"); const b = user("student-b");
  const inviteA = await invite(f, a, "student"); const inviteB = await invite(f, b, "student");
  const results = await Promise.allSettled([
    changeAccess(a, { action: "invite.accept", token: inviteA.result!.token }, f.db, now),
    changeAccess(b, { action: "invite.accept", token: inviteB.result!.token }, f.db, now),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_memberships WHERE role='student' AND status='active'").get()!.count, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_invites WHERE status='accepted'").get()!.count, 1);
  await rejectsStatus(invite(f, user("student-c"), "student"), 409);
  f.sqlite.close();
});

test("accept/revoke race is atomic: a revoked invitation never creates a membership", async () => {
  const f = fixture(); const member = user("race"); const created = await invite(f, member);
  await Promise.allSettled([
    changeAccess(member, { action: "invite.accept", token: created.result!.token }, f.db, now),
    changeAccess(owner, { action: "invite.revoke", workspaceId: owner.userId, id: created.result!.id }, f.db, now),
  ]);
  const row = f.sqlite.prepare("SELECT status FROM workspace_invites").get()!;
  const count = f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_memberships WHERE status='active'").get()!.count;
  assert.ok((row.status === "accepted" && count === 1) || (row.status === "revoked" && count === 0));
  f.sqlite.close();
});

test("a failed second batch statement rolls back the claim and permits a safe retry", async () => {
  const f = fixture(); const member = user("retry"); const created = await invite(f, member);
  f.failNextBatch();
  await assert.rejects(changeAccess(member, { action: "invite.accept", token: created.result!.token }, f.db, now), /second-statement/);
  assert.equal(f.sqlite.prepare("SELECT status FROM workspace_invites").get()!.status, "pending");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_memberships").get()!.count, 0);
  await changeAccess(member, { action: "invite.accept", token: created.result!.token }, f.db, now);
  assert.equal((await resolveAccess(member, owner.userId, f.db)).role, "parent");
  f.sqlite.close();
});

test("revocation preserves profile data and reinvitation can change role without upgrading an active member", async () => {
  const f = fixture(); const member = user("rejoin");
  const created = await invite(f, member, "reviewer");
  const beforeProfile = f.sqlite.prepare("SELECT state FROM workspaces WHERE user_id=?").get(owner.userId)!.state;
  await changeAccess(member, { action: "invite.accept", token: created.result!.token }, f.db, now);
  await rejectsStatus(invite(f, member, "parent"), 409);
  const overview = await getAccessOverview(owner, undefined, f.db); const membershipId = overview.members[0].id;
  await rejectsStatus(changeAccess(owner, { action: "invite.revoke", id: created.result!.id }, f.db, now), 409);
  await changeAccess(owner, { action: "member.revoke", id: membershipId }, f.db, now);
  await rejectsStatus(resolveAccess(member, owner.userId, f.db), 403);
  assert.equal((await listAccessibleWorkspaces(member, f.db)).length, 1);
  assert.equal(f.sqlite.prepare("SELECT state FROM workspaces WHERE user_id=?").get(owner.userId)!.state, beforeProfile);
  const newInvite = await invite(f, member, "parent");
  await changeAccess(member, { action: "invite.accept", token: newInvite.result!.token }, f.db, now);
  assert.equal((await resolveAccess(member, owner.userId, f.db)).role, "parent");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_memberships").get()!.count, 1);
  assert.equal((await getAccessOverview(owner, undefined, f.db)).members[0].id, membershipId);
  f.sqlite.close();
});

test("editors and reviewers cannot learn the student name from workspace lists", async () => {
  const f = fixture(); const reviewer = user("private-reviewer"); const editor = user("private-editor");
  for (const [member, role] of [[reviewer, "reviewer"], [editor, "editor"]] as const) {
    const created = await invite(f, member, role);
    await changeAccess(member, { action: "invite.accept", token: created.result!.token }, f.db, now);
    const overview = await getAccessOverview(member, owner.userId, f.db);
    assert.equal(overview.current.name, "已授权的教研空间");
    assert.ok(!JSON.stringify(overview).includes("小禾同学"));
    assert.deepEqual(overview.members, []); assert.deepEqual(overview.invites, []);
  }
  f.sqlite.close();
});

test("database constraints independently forbid a second active student and owner memberships", async () => {
  const f = fixture(); const member = user("db-student"); const created = await invite(f, member, "student");
  await changeAccess(member, { action: "invite.accept", token: created.result!.token }, f.db, now);
  const insert = f.sqlite.prepare("INSERT INTO workspace_memberships (id,workspace_id,user_id,email,name,role,status,created_at) VALUES (?,?,?,?,?,?,'active',?)");
  assert.throws(() => insert.run("second", owner.userId, "student2", "student2@example.test", "student2", "student", now), /UNIQUE/);
  assert.throws(() => insert.run("self", owner.userId, owner.userId, owner.email, "owner", "parent", now), /CHECK/);
  assert.throws(() => insert.run("admin", owner.userId, "newowner", "newowner@example.test", "newowner", "owner", now), /CHECK/);
  f.sqlite.close();
});

test("member revocation atomically invalidates every older pending invite for the bound email", async () => {
  const f = fixture(); const member = user("withdrawn");
  const first = await invite(f, member, "teacher");
  const olderReviewerInvite = await invite(f, member, "reviewer");
  const olderEditorInvite = await invite(f, member, "editor");
  await changeAccess(member, { action: "invite.accept", token: first.result!.token }, f.db, now);
  const membershipId = (await getAccessOverview(owner, undefined, f.db)).members[0].id;
  await changeAccess(owner, { action: "member.revoke", id: membershipId }, f.db, now);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_invites WHERE status='pending'").get()!.count, 0);
  for (const invitation of [olderReviewerInvite, olderEditorInvite]) {
    assert.equal(f.sqlite.prepare("SELECT status FROM workspace_invites WHERE id=?").get(invitation.result!.id!)!.status, "revoked");
    await rejectsStatus(changeAccess(member, { action: "invite.accept", token: invitation.result!.token }, f.db, now), 409);
  }
  await rejectsStatus(resolveAccess(member, owner.userId, f.db), 403);
  f.sqlite.close();
});

test("revocation batch rollback cannot leave old invites usable alongside a supposedly revoked member", async () => {
  const f = fixture(); const member = user("revoke-rollback");
  const first = await invite(f, member, "teacher"); const pending = await invite(f, member, "reviewer");
  await changeAccess(member, { action: "invite.accept", token: first.result!.token }, f.db, now);
  const membershipId = (await getAccessOverview(owner, undefined, f.db)).members[0].id;
  f.failNextBatch();
  await assert.rejects(changeAccess(owner, { action: "member.revoke", id: membershipId }, f.db, now), /second-statement/);
  assert.equal((await resolveAccess(member, owner.userId, f.db)).role, "teacher");
  assert.equal(f.sqlite.prepare("SELECT status FROM workspace_invites WHERE id=?").get(pending.result!.id!)!.status, "pending");
  await changeAccess(owner, { action: "member.revoke", id: membershipId }, f.db, now);
  assert.equal(f.sqlite.prepare("SELECT status FROM workspace_invites WHERE id=?").get(pending.result!.id!)!.status, "revoked");
  f.sqlite.close();
});

test("fresh invitation after revocation survives an idempotent revoke retry, even in the same millisecond", async () => {
  const f = fixture(); const member = user("fresh-after-withdrawal");
  const first = await invite(f, member, "teacher");
  await changeAccess(member, { action: "invite.accept", token: first.result!.token }, f.db, now);
  const membershipId = (await getAccessOverview(owner, undefined, f.db)).members[0].id;
  await changeAccess(owner, { action: "member.revoke", id: membershipId }, f.db, now);
  const fresh = await invite(f, member, "parent");
  await rejectsStatus(changeAccess(owner, { action: "member.revoke", id: membershipId }, f.db, now), 409);
  assert.equal(f.sqlite.prepare("SELECT status FROM workspace_invites WHERE id=?").get(fresh.result!.id!)!.status, "pending");
  const accepted = await changeAccess(member, { action: "invite.accept", token: fresh.result!.token }, f.db, now);
  assert.equal(accepted.overview.current.role, "parent");
  f.sqlite.close();
});

test("an invite creation delayed across acceptance and revocation cannot restore the withdrawn grant", async () => {
  const f = fixture(); const member = user("delayed-invite");
  const first = await invite(f, member, "teacher");
  f.beforeNextInviteInsert(async () => {
    await changeAccess(member, { action: "invite.accept", token: first.result!.token }, f.db, now);
    const membershipId = (await getAccessOverview(owner, undefined, f.db)).members[0].id;
    await changeAccess(owner, { action: "member.revoke", id: membershipId }, f.db, now);
  });
  await rejectsStatus(invite(f, member, "reviewer"), 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_invites WHERE status='pending'").get()!.count, 0);
  await rejectsStatus(resolveAccess(member, owner.userId, f.db), 403);
  f.sqlite.close();
});

test("acceptance independently rejects legacy pending tokens issued at or before the last revocation", async () => {
  const f = fixture(); const member = user("legacy-old-token");
  const first = await invite(f, member, "teacher"); const older = await invite(f, member, "reviewer");
  await changeAccess(member, { action: "invite.accept", token: first.result!.token }, f.db, now);
  const membershipId = (await getAccessOverview(owner, undefined, f.db)).members[0].id;
  await changeAccess(owner, { action: "member.revoke", id: membershipId }, f.db, now);
  // Simulate pre-fix data or a stale storage write: acceptance still fails closed.
  f.sqlite.prepare("UPDATE workspace_invites SET status='pending', revoked_at=NULL WHERE id=?").run(older.result!.id!);
  await rejectsStatus(changeAccess(member, { action: "invite.accept", token: older.result!.token }, f.db, now), 409);
  assert.equal(f.sqlite.prepare("SELECT status FROM workspace_memberships WHERE id=?").get(membershipId)!.status, "revoked");
  f.sqlite.close();
});
