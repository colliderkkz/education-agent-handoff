import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { createSeedWorkspace } from "../lib/seed.ts";
import * as domain from "../lib/server/domain.ts";
import { projectWorkspace } from "../lib/server/access-policy.ts";
import { resolveAccess } from "../lib/server/memberships.ts";
import { effectiveAttempt } from "../lib/effective-evidence.ts";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import type { AccessContext } from "../lib/access-types";
import type { ApiResult, EvidencePreview, Role, WorkspaceState } from "../lib/types";

const NOW = "2026-10-27T08:00:00.000Z";
const SHARED = "shared-owner";
const USER: ChatGPTUser = { userId: "shared-student", displayName: "共享空间学生", fullName: "共享空间学生", email: "student@example.test" };

// Execute the production route and HTTP helpers without loading platform-only auth
// or Cloudflare storage imports. Domain, projection and membership SQL remain real.
function loadModule(path: string, dependencies: Record<string, unknown>): Record<string, unknown> {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected route dependency: ${specifier}`);
    return dependencies[specifier];
  }, loaded, loaded.exports);
  return loaded.exports;
}

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
  for (const file of ["0000_great_wallop.sql", "0001_melodic_alex_power.sql"]) sql.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  const states = new Map<string, WorkspaceState>();
  for (const id of [SHARED, USER.userId]) {
    const state = createSeedWorkspace(id, id, NOW);
    state.messages = []; state.events = []; state.helpRequests = [];
    states.set(id, state);
    sql.prepare("INSERT INTO workspaces(user_id, revision, state, created_at, updated_at) VALUES (?, 0, ?, ?, ?)").run(id, JSON.stringify(state), NOW, NOW);
  }
  sql.prepare("INSERT INTO workspace_memberships(id, workspace_id, user_id, email, name, role, status, created_at) VALUES ('member-a', ?, ?, ?, ?, 'student', 'active', ?)").run(SHARED, USER.userId, USER.email, USER.displayName, NOW);
  const db = {
    prepare(query: string) {
      return { bind(...values: (string | number | null)[]) { return { async first() { return sql.prepare(query).get(...values) ?? null; } }; } };
    },
  } as unknown as Pick<D1Database, "prepare" | "batch">;
  let authenticated: ChatGPTUser | null = USER;
  let writes = 0;
  const selected: string[] = [];
  async function read(user: ChatGPTUser, access: AccessContext) {
    const state = structuredClone(states.get(access.ownerId)!);
    state.actor = { id: user.userId, name: user.displayName, role: access.role };
    state.access = { ...access, workspaces: [{ id: access.workspaceId, name: "共享空间", role: access.role }] };
    return state;
  }
  const http = loadModule("../lib/server/http.ts", { "./domain": domain });
  const route = loadModule("../app/api/workspace/route.ts", {
    "../../chatgpt-auth": { getChatGPTUser: async () => authenticated },
    "../../../lib/server/domain": domain,
    "../../../lib/server/http": http,
    "../../../lib/server/access-policy": { projectWorkspace },
    "../../../lib/server/history-file-gc": { retryHistoryFiles: async (actor: ChatGPTUser, access: AccessContext) => { if (!["owner", "student"].includes(access.role)) throw new domain.DomainError("无权清理", 403); return { state: await read(actor, access), pendingUploads: 0 }; } },
    "../../../lib/server/memberships": { resolveAccess: async (user: ChatGPTUser, id?: string) => {
      const access = await resolveAccess(user, id, db); selected.push(access.workspaceId); return access;
    } },
    "../../../lib/server/store": {
      readWorkspace: read,
      async changeWorkspace(user: ChatGPTUser, change: (state: WorkspaceState) => ApiResult, access: AccessContext) {
        const current = await read(user, access), result = change(current);
        if (result.state.revision !== current.revision) {
          assert.equal(result.state.revision, current.revision + 1);
          states.set(access.ownerId, structuredClone(result.state)); writes++;
        }
        return result;
      },
    },
  });
  const POST = route.POST as (request: Request) => Promise<Response>;
  return {
    states, selected, get writes() { return writes; }, close() { sql.close(); },
    setRole(role: Exclude<Role, "owner">) { sql.prepare("UPDATE workspace_memberships SET role = ?").run(role); },
    signInAsTeacher() {
      sql.prepare("INSERT INTO workspace_memberships(id, workspace_id, user_id, email, name, role, status, created_at) VALUES ('member-teacher', ?, 'teacher-b', 'teacher@example.test', '复核教师', 'teacher', 'active', ?)").run(SHARED, NOW);
      authenticated = { userId: "teacher-b", displayName: "复核教师", fullName: "复核教师", email: "teacher@example.test" };
    },
    signOut() { authenticated = null; },
    async post(body: Record<string, unknown>, query = `?workspaceId=${SHARED}`, headers: Record<string, string> = {}) {
      const response = await POST(new Request(`https://xiaohe.test/api/workspace${query}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://xiaohe.test", ...headers }, body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() as ApiResult & { error?: string }, headers: response.headers };
    },
  };
}

test("POST authorizes a shared selector and removes it before strict chat, memory and help commands", async () => {
  const f = fixture();
  try {
    const ownBefore = structuredClone(f.states.get(USER.userId));
    const q = f.states.get(SHARED)!.questions[0];
    const opened = await f.post({ action: "chat.open", workspaceId: SHARED, context: { source: "bank", questionId: q.id, questionVersion: q.version } });
    assert.equal(opened.status, 200, opened.body.error);
    const threadId = opened.body.result!.id!;
    assert.equal(opened.body.state.actor.role, "student");
    assert.equal(opened.body.state.companion!.threads[0].ownerId, USER.userId);
    assert.equal(opened.body.state.companion!.threads[0].snapshot, undefined);
    assert.equal(opened.headers.get("Cache-Control"), "private, no-store");
    const draft = await f.post({ action: "chat.draft.save", workspaceId: SHARED, threadId, text: "不要给答案", intent: "note", expectedDraftRevision: 0 });
    assert.equal(draft.status, 200, draft.body.error);
    const sent = await f.post({ action: "chat.send", workspaceId: SHARED, threadId, text: "不要给答案", intent: "note", expectedDraftRevision: 1, requestId: "route-chat-request" });
    assert.equal(sent.status, 200, sent.body.error);
    assert.equal(sent.body.state.messages.length, 2);
    assert.equal(f.states.get(SHARED)!.events.filter(e => e.action === "learning.exposure").length, 0);
    const preference = await f.post({ action: "memory.preference.set", workspaceId: SHARED, key: "presentation", value: "compact", sourceRevision: sent.body.state.revision }, "");
    assert.equal(preference.status, 200, preference.body.error); // body-only selector
    assert.equal(preference.body.state.companion!.preferences[0].value, "compact");
    const help = await f.post({ action: "help.create", topic: "本机学伴整理的求助", summary: "我希望核对列式", threadId, requestId: "route-help-request" });
    assert.equal(help.status, 200, help.body.error); // query-only selector
    const saved = f.states.get(SHARED)!.helpRequests.find(h => h.requestId === "route-help-request")!;
    assert.equal(saved.ownerId, USER.userId); assert.equal(saved.delivery, "workspace");
    assert.equal(saved.sourceThreadId, threadId); assert.equal(saved.context!.source, "bank");
    assert.ok(f.selected.every(id => id === SHARED));
    assert.deepEqual(f.states.get(USER.userId), ownBefore);
    assert.equal(f.writes, 5);
  } finally { f.close(); }
});

test("POST evidence review binds verified authority to a different current teacher and applies one shared result", async () => {
  const f = fixture();
  try {
    const made = await f.post({ action: "paper.create", count: 1, knowledgeIds: ["division"] }); assert.equal(made.status, 200, made.body.error);
    const paper = f.states.get(SHARED)!.papers.find(p => p.id === made.body.result!.id)!;
    const submitted = await f.post({ action: "attempt.submit", paperId: paper.id, submissionKey: "route-evidence-submit", answers: [{ questionId: paper.questions[0].id, value: "9999" }] });
    assert.equal(submitted.status, 200, submitted.body.error);
    const entry = f.states.get(SHARED)!.evidence.find(e => e.paperId === paper.id)!;
    const proposed = await f.post({ action: "evidence.propose", workspaceId: SHARED, evidenceId: entry.id, patch: { answer: entry.expected }, reason: "核对原稿录入", uploadIds: [], sourceRevision: submitted.body.state.revision, requestId: "route-evidence-propose" });
    assert.equal(proposed.status, 200, proposed.body.error);
    const proposalId = proposed.body.result!.id!, immutable = structuredClone(f.states.get(SHARED)!.evidence);
    assert.equal((await f.post({ action: "evidence.preview", proposalId, outcome: "accept" })).status, 403);
    assert.equal((await f.post({ action: "local.evidence.confirm", proposalId, outcome: "accept", channel: "local" })).status, 400);
    assert.equal((await f.post({ action: "local.evidence.confirm", proposalId, outcome: "accept" })).status, 403);
    f.setRole("teacher"); // Changing one's role cannot permit self-review.
    assert.equal((await f.post({ action: "evidence.preview", proposalId, outcome: "accept" })).status, 403);
    f.signInAsTeacher();
    const previewed = await f.post({ action: "evidence.preview", workspaceId: SHARED, proposalId, outcome: "accept" }); assert.equal(previewed.status, 200, previewed.body.error);
    const preview = previewed.body.result!.preview as EvidencePreview;
    assert.equal(preview.authority, "teacher-verified"); assert.equal(preview.report.afterCorrect, 1);
    const command = { action: "evidence.review", workspaceId: SHARED, proposalId, outcome: "accept", reason: "已核对原稿答案", sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: "route-evidence-decision" };
    const reviewed = await f.post(command); assert.equal(reviewed.status, 200, reviewed.body.error);
    assert.equal(effectiveAttempt(reviewed.body.state, entry.attemptId)!.correctCount, 1);
    assert.equal(reviewed.body.state.evidenceReviews!.decisions[0].actorId, "teacher-b");
    assert.equal(reviewed.body.state.evidenceReviews!.decisions[0].authority, "teacher-verified");
    assert.deepEqual(f.states.get(SHARED)!.evidence, immutable);
    const writes = f.writes; assert.equal((await f.post(command)).status, 200); assert.equal(f.writes, writes);
  } finally { f.close(); }
});

test("POST strips only workspaceId; forged actor, role and local channel remain rejected", async () => {
  const f = fixture();
  try {
    const before = structuredClone(f.states.get(SHARED));
    const commands = [
      { action: "chat.open", context: { source: "general" } },
      { action: "memory.preference.set", key: "presentation", value: "compact", sourceRevision: 0 },
      { action: "help.create", topic: "求助", summary: "我想核对", requestId: "forged-help" },
    ];
    for (const command of commands) for (const [key, value] of Object.entries({ actor: { id: SHARED, role: "owner" }, role: "owner", channel: "local" })) {
      const response = await f.post({ ...command, workspaceId: SHARED, [key]: value });
      assert.equal(response.status, 400, `${command.action}/${key}: ${response.body.error}`);
      assert.match(response.body.error!, /字段/);
    }
    assert.equal(f.writes, 0); assert.deepEqual(f.states.get(SHARED), before);
  } finally { f.close(); }
});

test("POST preserves selector ambiguity, authorization and origin rejection before any write", async () => {
  const f = fixture();
  try {
    const command = { action: "chat.open", context: { source: "general" } };
    for (const [body, query] of [
      [{ ...command, workspaceId: USER.userId }, `?workspaceId=${SHARED}`],
      [{ ...command, workspaceId: SHARED }, `?workspaceId=${SHARED}&workspaceId=${SHARED}`],
      [{ ...command, workspaceId: { id: SHARED } }, ""],
      [{ ...command, workspaceId: " " }, ""],
    ] as const) assert.equal((await f.post(body, query)).status, 400);
    assert.deepEqual(f.selected, []);
    assert.equal((await f.post({ ...command, workspaceId: "unrelated-owner" }, "")).status, 403);
    assert.equal((await f.post({ ...command, workspaceId: SHARED }, `?workspaceId=${SHARED}`, { origin: "https://attacker.test" })).status, 403);
    f.setRole("teacher");
    assert.equal((await f.post({ ...command, workspaceId: SHARED, role: "owner" })).status, 403);
    f.signOut();
    assert.equal((await f.post({ ...command, workspaceId: SHARED })).status, 401);
    assert.equal(f.writes, 0);
  } finally { f.close(); }
});

test("POST history preview/confirm is actor-bound, idempotent and never accepts client file keys", async () => {
  const f = fixture();
  try {
    const original = f.states.get(SHARED)!;
    const evidence = original.evidence[0];
    const selection = { evidenceIds: [evidence.id], uploadIds: [] };
    const previewed = await f.post({ action: "history.delete.preview", workspaceId: SHARED, ...selection });
    assert.equal(previewed.status, 200, previewed.body.error); assert.equal(f.writes, 0);
    const preview = previewed.body.result!.preview as { sourceRevision: number; digest: string };
    const command = { action: "history.delete.confirm", ...selection, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: "route-history-request" };
    const invalid = await f.post({ ...command, objectKey: "private/another-owner/guess" }); assert.equal(invalid.status, 400); assert.equal(f.writes, 0);
    const result = await f.post(command); assert.equal(result.status, 200, result.body.error); assert.equal(result.body.result!.deleted, true);
    assert.ok(!result.body.state.evidence.some(item => item.id === evidence.id));
    assert.ok(!f.states.get(SHARED)!.attempts.find(item => item.id === evidence.attemptId)!.answers.some(answer => answer.questionId === evidence.questionId));
    const again = await f.post(command); assert.equal(again.status, 200, again.body.error); assert.equal(again.body.result!.id, result.body.result!.id); assert.equal(f.writes, 1);
    for (const role of ["parent", "teacher", "editor", "reviewer"] as const) {
      f.setRole(role); assert.equal((await f.post({ action: "history.delete.preview", ...selection })).status, 403);
      assert.equal((await f.post({ action: "history.files.retry" })).status, 403);
    }
    f.setRole("student"); assert.equal((await f.post({ action: "history.files.retry", uploadIds: ["guessed"] })).status, 400);
  } finally { f.close(); }
});
