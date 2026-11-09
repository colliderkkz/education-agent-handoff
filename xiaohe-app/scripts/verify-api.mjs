#!/usr/bin/env node
/**
 * Stateful local integration verification. Run only against the Vite dev server
 * with Sites' existing local sign-in middleware and migrated local D1/R2:
 *   node scripts/verify-api.mjs http://127.0.0.1:5173
 * Uses the real /signin-with-chatgpt cookie flow. It never injects identity headers,
 * resets a workspace, or runs against a public deployment. It leaves clearly named
 * verification records in the local workspace. Keep other writers idle during it.
 */
import assert from "node:assert/strict";

const base = new URL(process.argv[2] || "http://127.0.0.1:5173");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname.replace(/^\[|\]$/g, "")), "Refusing non-loopback API verification");
assert.ok(["http:", "https:"].includes(base.protocol) && !base.username && !base.password && base.pathname === "/", "Supply a loopback HTTP origin only");
const origin = base.origin;
const runId = `api-verification-${Date.now()}`;
const completed = [];
let cookie = "";

async function request(path, { auth = true, expected = 200, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(new URL(path, base), { method, body, redirect: "manual", headers: { ...(auth && cookie ? { Cookie: cookie } : {}), ...headers } });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json;
  try { json = JSON.parse(text); } catch { /* Image and HTML responses are inspected as bytes. */ }
  assert.equal(response.status, expected, `${method} ${path}: ${response.status}; ${json?.error || text.slice(0, 200)}`);
  return { response, bytes, text, json };
}
async function action(action, payload = {}, expected = 200, originHeader = origin) {
  const result = await request("/api/workspace", { method: "POST", expected, body: JSON.stringify({ action, ...payload }), headers: { "Content-Type": "application/json", Origin: originHeader } });
  return result.json;
}
async function workspace() { return (await request("/api/workspace")).json.state; }
function check(name) { completed.push(name); console.log(`PASS ${name}`); }
function available(state) {
  const unavailable = new Set();
  for (const event of state.events.filter(e => e.action === "learning.exposure")) {
    try { for (const id of JSON.parse(event.detail).familyIds || []) unavailable.add(id); } catch { /* Legacy audit. */ }
  }
  for (const paper of state.papers.filter(p => Date.now() - Date.parse(p.createdAt) < 14 * 86400000)) for (const q of paper.questions) unavailable.add(q.familyId);
  return state.questions.filter(q => q.status === "published" && q.authorId !== q.reviewerId && q.reviewerId && !unavailable.has(q.familyId));
}
function originalAnswers(paper) { return paper.questions.map(q => ({ questionId: q.id, value: q.answer, working: `${runId} 列式验算`, help: "independent", correct: false })); }

await request("/api/workspace", { auth: false, expected: 401 });
await request("/api/files/not-owned", { auth: false, expected: 401 });
check("anonymous requests cannot read workspace or files");

const signIn = await request("/signin-with-chatgpt?return_to=%2F", { auth: false, expected: 302 });
const cookies = signIn.response.headers.getSetCookie();
cookie = cookies.map(value => value.split(";", 1)[0]).join("; ");
assert.ok(cookie, "Local sign-in did not issue a cookie; use the Vite dev server with Sites middleware");
let state = await workspace();
assert.ok(state.actor.id && state.actor.role === "owner");
assert.equal(state.capabilities.ocr, false);
assert.equal(state.capabilities.ai, false);
const initialProfile = structuredClone(state.profile);
assert.equal(initialProfile.grade, "四年级", "Use a four-year mathematics pilot workspace for integration verification");
assert.equal(initialProfile.course, "数学");
assert.ok(state.uploads.length < 100, "Local workspace upload capacity is exhausted");
assert.ok(available(state).length >= 5, "Need at least five unexposed/unreserved published families; use a fresh local database without deleting user data");
check("authenticated workspace loads through issued local sign-in cookie");

const beforeCsrf = state.revision;
await action("profile.update", { profile: { name: "must-not-change" } }, 403, "https://different-origin.invalid");
await request("/api/workspace", { method: "POST", expected: 403, body: JSON.stringify({ action: "help.create", topic: "blocked", summary: "blocked" }), headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" } });
state = await workspace();
assert.equal(state.revision, beforeCsrf);
assert.deepEqual(state.profile, initialProfile);
check("cross-origin mutations are rejected without writes");

const created = await action("paper.create", { count: 3, kind: "practice", difficulty: "不限", knowledgeIds: ["division", "geometry", "multiplication"] });
const paper = created.state.papers.find(p => p.id === created.result.id);
assert.equal(paper.questions.length, 3);
const answers = originalAnswers(paper);
answers[2].value = "-999999";
await Promise.all([
  action("attempt.save", { paperId: paper.id, answers }),
  action("attempt.help", { paperId: paper.id, questionId: paper.questionIds[0], level: "hint" }),
]);
state = await workspace();
let attempt = state.attempts.find(a => a.paperId === paper.id);
assert.deepEqual(attempt.answers.map(a => a.value), answers.map(a => a.value));
assert.equal(attempt.answers[0].help, "hint");
assert.equal(state.revision, created.state.revision + 2, "Concurrent writes must each advance the persisted revision");
check("concurrent draft save and help record both survive CAS retries");

const submitted = await action("attempt.submit", { paperId: paper.id, answers, submissionKey: `${runId}-submission`, correctCount: 999, independentCount: 999 });
attempt = submitted.state.attempts.find(a => a.paperId === paper.id);
assert.equal(attempt.correctCount, 2);
assert.equal(attempt.independentCount, 2);
assert.equal(attempt.answers[0].help, "hint");
const originalEvidence = structuredClone(submitted.state.evidence.filter(e => e.paperId === paper.id));
const replay = await action("attempt.submit", { paperId: paper.id, answers: answers.map(a => ({ ...a, value: "0" })), submissionKey: `${runId}-replay` });
assert.equal(replay.state.revision, submitted.state.revision);
assert.deepEqual(replay.state.evidence.filter(e => e.paperId === paper.id), originalEvidence);
await action("attempt.save", { paperId: paper.id, answers }, 409);
check("server grades answers and immutable submission replay cannot duplicate or alter evidence");

const mistake = submitted.state.mistakes.find(m => m.question.id === paper.questionIds[2]);
const corrected = await action("mistake.correct", { id: mistake.id, answer: mistake.question.answer });
assert.deepEqual(corrected.state.evidence, replay.state.evidence);
assert.deepEqual(corrected.state.knowledge, replay.state.knowledge);
const printed = await action("paper.expose", { paperId: paper.id });
assert.deepEqual(printed.state.attempts.find(a => a.paperId === paper.id), attempt);
check("correction and printing a submitted answer key preserve original results and stars");

const nextCreated = await action("paper.create", { count: 1, knowledgeIds: ["division", "geometry", "multiplication"] });
const nextPaper = nextCreated.state.papers.find(p => p.id === nextCreated.result.id);
assert.ok(!paper.questions.some(q => q.familyId === nextPaper.questions[0].familyId));
await action("paper.expose", { paperId: nextPaper.id });
const assisted = await action("attempt.submit", { paperId: nextPaper.id, answers: originalAnswers(nextPaper), submissionKey: `${runId}-printed` });
assert.equal(assisted.state.attempts.find(a => a.paperId === nextPaper.id).independentCount, 0);
assert.ok(assisted.state.evidence.filter(e => e.paperId === nextPaper.id).every(e => !e.eligible));
check("answer-key exposure downgrades unfinished attempts and exposed families are excluded from future papers");

const sourceQuestion = state.questions.find(q => q.status === "published");
const authorDraft = await action("question.create", { question: { ...sourceQuestion, text: `${runId}：${sourceQuestion.text}`, authorId: "forged-author", reviewerId: "forged-reviewer", status: "approved" } });
const authorQuestionId = authorDraft.result.id;
assert.equal(authorDraft.state.questions.find(q => q.id === authorQuestionId).authorId, state.actor.id);
assert.equal(authorDraft.state.questions.find(q => q.id === authorQuestionId).status, "draft");
await action("question.submit", { id: authorQuestionId });
await action("question.review", { id: authorQuestionId, decision: "approve", actor: { role: "reviewer" } }, 403);
await action("question.publish", { id: authorQuestionId }, 403);
state = await workspace();
const independentDraft = state.questions.find(q => q.status === "review" && q.authorId !== state.actor.id);
if (independentDraft) {
  await action("question.review", { id: independentDraft.id, decision: "approve", note: `${runId} 已核对题意、答案、过程与替代解法` });
  const published = await action("question.publish", { id: independentDraft.id });
  assert.equal(published.state.questions.find(q => q.id === independentDraft.id).status, "published");
  check("independently authored seed review sample completes approval then publication");
} else {
  console.log("NOTE no unprocessed independent review sample remains; this workflow is covered by domain tests, not repeated here");
}
check("author/reviewer separation cannot be bypassed through request fields");

// A real, valid 1×1 PNG. Round-trip bytes prove R2 storage, not just upload metadata.
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=", "base64"));
const uploadForm = new FormData();
uploadForm.set("file", new Blob([png], { type: "image/png" }), `${runId}.png`);
uploadForm.set("purpose", "homework");
const beforeConcurrent = (await workspace()).revision;
const [uploadResponse, helpA, helpB] = await Promise.all([
  request("/api/upload", { method: "POST", body: uploadForm, expected: 201, headers: { Origin: origin } }),
  action("help.create", { topic: `${runId}-A`, summary: "本地接口并发验证 A" }),
  action("help.create", { topic: `${runId}-B`, summary: "本地接口并发验证 B" }),
]);
const uploadId = uploadResponse.json.result.id;
state = await workspace();
assert.equal(state.revision, beforeConcurrent + 3);
assert.ok(state.uploads.some(u => u.id === uploadId));
assert.ok(state.helpRequests.some(h => h.id === helpA.result.id));
assert.ok(state.helpRequests.some(h => h.id === helpB.result.id));
const image = await request(`/api/files/${uploadId}`);
assert.equal(image.response.headers.get("content-type"), "image/png");
assert.deepEqual(image.bytes, png);
await request(`/api/files/${uploadId}`, { auth: false, expected: 401 });
await request(`/api/files/${crypto.randomUUID()}`, { expected: 404 });
check("R2 bytes round-trip and concurrent upload plus two workspace writes persist all three revisions");

const photoQuestion = state.questions.find(q => q.status === "published");
const photo = await action("homework.confirm", { uploadId, entries: [{ questionId: photoQuestion.id, answer: photoQuestion.answer, help: "independent" }] });
const photoAttempt = photo.state.attempts.find(a => a.paperId === photo.result.id);
assert.equal(photoAttempt.correctCount, 1);
assert.equal(photoAttempt.independentCount, 0);
assert.equal(photoAttempt.answers[0].help, "unknown");
assert.ok(photo.state.evidence.filter(e => e.attemptId === photoAttempt.id).every(e => !e.eligible));
await action("homework.confirm", { uploadId, entries: [] }, 409);
check("manual photo confirmation records original evidence once without trusting claimed independence");

const final = await workspace();
assert.ok(final.papers.some(p => p.id === paper.id));
assert.ok(final.uploads.some(u => u.id === uploadId && u.status === "confirmed"));
console.log(JSON.stringify({ passed: completed.length, runId, initialRevision: beforeCsrf, finalRevision: final.revision, paperId: paper.id, photoPaperId: photo.result.id, uploadId, limits: ["Local mock authentication has one account; cross-account isolation also requires source review and a two-account deployed test.", "This script does not prove persistence across process restarts; rerun a read after restart using the printed record IDs."] }, null, 2));
