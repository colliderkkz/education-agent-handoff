#!/usr/bin/env node
/** Local-only authorization integration: real Sites dev login + isolated D1 fixtures.
 * Does not change identity middleware, inject user headers, or touch production.
 * Synthetic owner spaces and clearly labelled invitations remain for browser QA.
 * Run: node --experimental-strip-types scripts/verify-access-api.mjs http://127.0.0.1:5173
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createSeedWorkspace } from "../lib/seed.ts";

const base = new URL(process.argv[2] || "http://127.0.0.1:5173");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname) && base.pathname === "/" && !base.username && !base.password, "Local HTTP origin required");
const root = new URL("../", import.meta.url);
const directory = new URL(".wrangler/state/v3/d1/miniflare-D1DatabaseObject/", root);
const databases = readdirSync(directory).filter(name => name.endsWith(".sqlite") && name !== "metadata.sqlite");
assert.equal(databases.length, 1, "Expected exactly one local D1 database; choose an isolated checkout instead of guessing");
const db = new DatabaseSync(new URL(databases[0], directory));
db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'workspace_memberships'").get(), "Apply membership migration first");
const runId = `access-api-${randomUUID()}`;
const now = new Date().toISOString();
const passed = [];
let cookie = "";
function check(label) { passed.push(label); console.log(`PASS ${label}`); }
async function request(path, { method = "GET", body, status = 200, auth = true, origin = base.origin } = {}) {
  const response = await fetch(new URL(path, base), { method, redirect: "manual", headers: { ...(auth && cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: origin } : {}), ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Image bytes or redirect body. */ }
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
  return { response, data, bytes };
}
const accessAction = (action, payload = {}, status = 200) => request("/api/access", { method: "POST", body: { ...payload, action }, status });
const action = (workspaceId, action, payload = {}, status = 200) => request("/api/workspace", { method: "POST", body: { ...payload, action, workspaceId }, status });
const workspace = async id => (await request(`/api/workspace?workspaceId=${encodeURIComponent(id)}`)).data.state;
function fixture(id, name) {
  const state = createSeedWorkspace(id, name, now);
  state.profile.name = name;
  state.messages.push({ id: `${runId}-secret`, role: "user", text: "private-chat-marker", createdAt: now });
  db.prepare("INSERT INTO workspaces (user_id,revision,state,created_at,updated_at) VALUES (?,0,?,?,?)").run(id, JSON.stringify(state), now, now);
  return state;
}

try {
  await request("/api/access", { auth: false, status: 401 });
  const login = await request("/signin-with-chatgpt?return_to=%2F", { auth: false, status: 302 });
  cookie = login.response.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; ");
  assert.ok(cookie, "Use Sites local dev server, not the production Worker preview");
  const own = (await request("/api/workspace")).data.state;
  const userId = own.actor.id;
  assert.equal(userId, "local_seedy", "This verifier intentionally supports only the known local mock account");
  const email = "seedy@sites.test";
  await request("/api/access", { method: "POST", body: { action: "invite.create", role: "parent", email: "blocked@example.test" }, status: 403, origin: "https://untrusted.invalid" });
  await request("/api/workspace", { method: "POST", body: null, status: 400 });
  check("anonymous and cross-origin membership requests are blocked; malformed actions return 400");

  const createdInvite = (await accessAction("invite.create", { role: "parent", email: `${runId}@example.test`, label: "本地权限验证邀请" })).data;
  const token = createdInvite.result.token;
  assert.match(token, /^[a-f0-9]{64}$/);
  const storedInvite = db.prepare("SELECT * FROM workspace_invites WHERE id=?").get(createdInvite.result.id);
  assert.equal(storedInvite.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.ok(!JSON.stringify(storedInvite).includes(token));
  assert.ok(!JSON.stringify((await request("/api/access")).data).includes(token));
  await accessAction("invite.accept", { token }, 409);
  await accessAction("invite.revoke", { id: createdInvite.result.id });
  assert.equal(db.prepare("SELECT status FROM workspace_invites WHERE id=?").get(createdInvite.result.id).status, "revoked");
  check("owner invitation is email-bound, stored only as a hash, absent from lists, and revocable");

  const learnerId = `${runId}-learner`;
  fixture(learnerId, "权限验证学员");
  const inviteToken = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO workspace_invites (id,workspace_id,token_hash,role,email,label,status,created_at,expires_at) VALUES (?,?,?,'student',?,'本地独立空间测试','pending',?,?)").run(`${runId}-invite`, learnerId, createHash("sha256").update(inviteToken).digest("hex"), email, now, new Date(Date.now() + 86400000).toISOString());
  const accepted = (await accessAction("invite.accept", { token: inviteToken })).data;
  assert.equal(accepted.overview.current.role, "student");
  assert.equal(accepted.overview.current.id, learnerId);
  assert.deepEqual(accepted.overview.members, []);
  assert.deepEqual(accepted.overview.invites, []);
  await accessAction("invite.accept", { token: inviteToken }, 409);
  await request(`/api/workspace?workspaceId=${runId}-unknown`, { status: 403 });
  await accessAction("invite.create", { workspaceId: learnerId, role: "reviewer", email: "escalation@example.test", actor: { role: "owner" } }, 403);
  check("accepting one invitation grants the assigned space once and cannot grant owner powers");

  const ownRevision = (await request("/api/workspace")).data.state.revision;
  const queryOnly = (await request(`/api/workspace?workspaceId=${learnerId}`, { method: "POST", body: { action: "single.match", text: "300" } })).data.state;
  assert.equal(queryOnly.access.workspaceId, learnerId);
  await request(`/api/workspace?workspaceId=${learnerId}`, { method: "POST", body: { workspaceId: userId, action: "profile.update", profile: { name: "must-not-change" } }, status: 400 });
  await request(`/api/workspace?workspaceId=${learnerId}&workspaceId=${userId}`, { status: 400 });
  await request("/api/workspace", { method: "POST", body: { workspaceId: null, action: "profile.update", profile: { name: "must-not-change" } }, status: 400 });
  assert.equal((await request("/api/workspace")).data.state.revision, ownRevision);
  check("workspace query and body target consistently; conflicts or malformed selectors cannot silently write elsewhere");

  let state = await workspace(learnerId);
  assert.equal(state.actor.role, "student");
  assert.ok(state.questions.every(q => q.status === "published" && !q.answer && !q.hint && !q.steps.length && !q.reviewNote));
  const studentPaper = (await action(learnerId, "paper.create", { count: 2, knowledgeIds: ["division", "geometry"], difficulty: "基础" })).data;
  const paperId = studentPaper.result.id;
  let paper = studentPaper.state.papers.find(p => p.id === paperId);
  assert.ok(paper.questions.every(q => !q.answer && !q.hint && !q.steps.length));
  await action(learnerId, "question.disable", { id: paper.questions[0].id, role: "owner", actor: { role: "owner" } }, 403);
  const hinted = (await action(learnerId, "attempt.help", { paperId, questionId: paper.questions[0].id, level: "hint" })).data.state;
  const hintedQuestion = hinted.papers.find(p => p.id === paperId).questions[0];
  assert.ok(hintedQuestion.hint && !hintedQuestion.answer && !hintedQuestion.steps.length);
  const full = (await action(learnerId, "attempt.help", { paperId, questionId: paper.questions[1].id, level: "explanation" })).data.state;
  assert.ok(full.papers.find(p => p.id === paperId).questions[1].answer);
  const serverState = JSON.parse(db.prepare("SELECT state FROM workspaces WHERE user_id=?").get(learnerId).state);
  paper = serverState.papers.find(p => p.id === paperId);
  const answers = paper.questions.map(q => ({ questionId: q.id, value: q.answer, working: "本地权限验证", help: "independent", correct: true }));
  const submitted = (await action(learnerId, "attempt.submit", { paperId, answers })).data.state;
  assert.equal(submitted.attempts.find(a => a.paperId === paperId).correctCount, 2);
  assert.equal(submitted.attempts.find(a => a.paperId === paperId).independentCount, 0);
  assert.ok(submitted.papers.find(p => p.id === paperId).questions.every(q => q.answer));
  assert.ok(submitted.questions.some(q => !q.answer), "Unrelated bank answers must remain hidden");
  check("student responses hide answers until allowed; hints and explanations retain distinct evidence");

  const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=", "base64"));
  const form = new FormData(); form.set("file", new Blob([png], { type: "image/png" }), `${runId}.png`); form.set("purpose", "single");
  const uploaded = (await request(`/api/upload?workspaceId=${learnerId}`, { method: "POST", body: form, status: 201 })).data;
  assert.equal(uploaded.state.actor.role, "student");
  assert.ok(uploaded.state.questions.some(q => !q.answer));
  const fileId = uploaded.result.id;
  assert.deepEqual((await request(`/api/files/${fileId}`)).bytes, png);
  assert.equal(db.prepare("SELECT user_id FROM uploaded_files WHERE id=?").get(fileId).user_id, learnerId);
  const helpId = (await action(learnerId, "help.create", { topic: "共享求助主题", summary: "只分享这份摘要" })).data.result.id;
  await action(learnerId, "paper.create", { count: 1, knowledgeIds: ["division"] });
  check("student upload belongs to the shared learner space and upload responses keep answer filtering");

  const role = value => db.prepare("UPDATE workspace_memberships SET role=? WHERE workspace_id=? AND user_id=?").run(value, learnerId, userId);
  role("parent"); state = await workspace(learnerId);
  assert.equal(state.actor.role, "parent");
  assert.deepEqual(state.questions, []); assert.deepEqual(state.messages, []); assert.deepEqual(state.uploads, []); assert.deepEqual(state.helpRequests, []);
  assert.ok(state.attempts.every(a => a.status === "submitted"));
  assert.ok(state.papers.every(p => state.attempts.some(a => a.paperId === p.id)));
  await action(learnerId, "attempt.save", { paperId, answers }, 403);
  await request(`/api/files/${fileId}`, { status: 404 });
  await request(`/api/upload?workspaceId=${learnerId}`, { method: "POST", body: form, status: 403 });
  check("parent sees submitted reports only and cannot read photos, drafts, chats, help, or write answers");

  role("teacher"); state = await workspace(learnerId);
  assert.deepEqual(state.messages, []); assert.deepEqual(state.uploads, []);
  assert.ok(state.helpRequests.some(h => h.id === helpId));
  const replied = (await action(learnerId, "help.reply", { id: helpId, reply: "先估算，再用乘法检查。" })).data.state;
  assert.equal(replied.helpRequests.find(h => h.id === helpId).status, "replied");
  await action(learnerId, "question.create", { question: paper.questions[0] }, 403);
  await request(`/api/files/${fileId}`, { status: 404 });
  check("teacher can reply only to explicitly shared help and cannot access private learning material");

  role("editor"); state = await workspace(learnerId);
  assert.ok(state.questions.some(q => q.answer));
  assert.deepEqual(state.papers, []); assert.deepEqual(state.messages, []); assert.deepEqual(state.evidence, []); assert.deepEqual(state.uploads, []);
  assert.ok(!state.profile.name.includes("权限验证学员"));
  assert.equal(state.access.workspaces.find(w => w.id === learnerId).name, "已授权的教研空间");
  const editorQuestion = (await action(learnerId, "question.create", { question: { ...paper.questions[0], text: "权限测试编辑题", source: "权限测试" } })).data.result.id;
  await action(learnerId, "question.submit", { id: editorQuestion });
  await action(learnerId, "question.review", { id: editorQuestion, decision: "approve" }, 403);
  role("reviewer");
  await action(learnerId, "question.review", { id: editorQuestion, decision: "approve" }, 403);
  state = await workspace(learnerId);
  const independent = state.questions.find(q => q.status === "review" && q.authorId !== userId);
  assert.ok(independent);
  await action(learnerId, "question.review", { id: independent.id, decision: "approve", note: "权限验证独立审核" });
  const published = (await action(learnerId, "question.publish", { id: independent.id })).data.state;
  assert.equal(published.questions.find(q => q.id === independent.id).status, "published");
  await action(learnerId, "question.create", { question: paper.questions[0] }, 403);
  check("editor and reviewer have separate powers; changing role cannot bypass author/reviewer separation");

  const beforeRevoke = db.prepare("SELECT revision FROM workspaces WHERE user_id=?").get(learnerId).revision;
  db.prepare("UPDATE workspace_memberships SET status='revoked',revoked_at=? WHERE workspace_id=? AND user_id=?").run(now, learnerId, userId);
  await request(`/api/workspace?workspaceId=${learnerId}`, { status: 403 });
  await action(learnerId, "help.reply", { id: helpId, reply: "must-not-persist" }, 403);
  await request(`/api/files/${fileId}`, { status: 404 });
  assert.equal(db.prepare("SELECT revision FROM workspaces WHERE user_id=?").get(learnerId).revision, beforeRevoke);
  check("revocation blocks subsequent reads, writes, and file reads without changing the learner revision");

  // Preserve a student fixture and two report-only views for manual browser QA.
  db.prepare("UPDATE workspace_memberships SET status='active',role='student',revoked_at=NULL WHERE workspace_id=? AND user_id=?").run(learnerId, userId);
  const previews = { student: learnerId };
  for (const previewRole of ["parent", "teacher", "reviewer"]) {
    const id = `${runId}-${previewRole}`;
    const current = JSON.parse(db.prepare("SELECT state FROM workspaces WHERE user_id=?").get(learnerId).state);
    current.profile.name = `权限验证${previewRole}`; current.uploads = [];
    db.prepare("INSERT INTO workspaces (user_id,revision,state,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, current.revision, JSON.stringify(current), now, now);
    db.prepare("INSERT INTO workspace_memberships (id,workspace_id,user_id,email,name,role,status,created_at) VALUES (?,?,?,?,?,?,'active',?)").run(randomUUID(), id, userId, email, "本地角色验证", previewRole, now);
    previews[previewRole] = id;
  }
  const result = { runId, passed: passed.length, previews, fileId, limits: ["Uses the actual local login cookie plus isolated database role fixtures; does not simulate different production browser identities.", "Hosted two-account acceptance requires the user to authorize Site audience and each account to sign in."] };
  mkdirSync(new URL("outputs/qa/", root), { recursive: true });
  writeFileSync(new URL("outputs/qa/access-api-result.json", root), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { db.close(); }
