import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createSeedWorkspace } from "../lib/seed.ts";
import { applyAction } from "../lib/server/domain.ts";
import { projectWorkspace } from "../lib/server/access-policy.ts";
import { readChatEntryContext, writeChatEntryContext } from "../lib/chat-navigation.ts";
import { chatDraftStorageKey, chatDraftKeysToPrune, recoverChatDraft } from "../lib/chat-draft-cache.ts";

// Render the real TSX with React; remove CSS imports only. No browser behavior is
// inferred from these tests, and no production module is stubbed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const compiled = new Map();
function tsxModule(file) {
  if (compiled.has(file)) return compiled.get(file);
  let code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  }).outputText;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  code = code.replace(/from\s+(["'])([^"']+)\1/g, (_, quote, name) => {
    let resolved;
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      resolved = [base, `${base}.ts`, `${base}.tsx`].find(candidate => existsSync(candidate));
      assert.ok(resolved, `Module exists: ${name}`);
    } else resolved = require.resolve(name);
    const url = /\.tsx?$/.test(resolved) ? tsxModule(resolved) : pathToFileURL(resolved).href;
    return `from ${JSON.stringify(url)}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  compiled.set(file, url);
  return url;
}
const { default: CompanionChat, chatSendPayload, CompanionContextCard, CompanionMessageList, CompanionPreferences, CompanionHelpPreview } = await import(tsxModule(path.join(root, "components/companion-chat.tsx")));
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const now = "2026-10-27T10:00:00.000Z";
let serial = 0;
const ctx = { userId: "web-learner", role: "student", now, newId: () => `web-chat-${++serial}` };
function fixture(source = "bank") {
  const state = createSeedWorkspace(ctx.userId, "学习者", now);
  state.actor.role = "student"; state.messages = []; state.events = [];
  const question = state.questions[0];
  const context = source === "general" ? { source } : { source, questionId: question.id, questionVersion: question.version };
  const opened = applyAction(state, { action: "chat.open", context }, ctx);
  return { state: opened.state, thread: opened.state.companion.threads[0] };
}
const props = state => ({ state, mutate: async () => undefined, navigate() {}, busy: false });

test("ordinary text never infers help intent, including negative answer/solution phrases", () => {
  const { state, thread } = fixture();
  const text = "  不要给答案，也不用讲解。我想自己试试。  ";
  const payload = chatSendPayload(thread.id, "note", text, "explicit-note", 0);
  assert.equal(payload.intent, "note"); assert.equal(payload.text, text);
  assert.equal(payload.threadId, thread.id); assert.equal(payload.questionId, undefined);
  const result = applyAction(state, { action: "chat.send", ...payload }, ctx);
  assert.equal(result.state.events.filter(event => event.action === "learning.exposure").length, 0);
  assert.doesNotMatch(result.state.messages.at(-1).text, /答案：/);
  assert.throws(() => chatSendPayload(thread.id, "auto", text, "bad"), /明确/);
  assert.throws(() => chatSendPayload(thread.id, "note", "  ", "empty"), /写下/);
});

test("explicit help request is frozen to paper v2 when the current bank contains v3", () => {
  const initial = createSeedWorkspace(ctx.userId, "学习者", now); initial.actor.role = "student"; initial.messages = [];
  const original = { ...initial.questions[0], version: 2, text: "ORIGINAL_V2_TEXT", steps: ["ORIGINAL_V2_STEPS"], answer: "SECRET_V2_ANSWER" };
  initial.papers = [{ id: "web-original-paper", title: "原卷", version: 1, questionIds: [original.id], questions: [original], createdAt: now, status: "ready", kind: "practice", reason: "测试", estimatedMinutes: 2 }];
  initial.questions[0] = { ...original, version: 3, text: "CURRENT_V3_TEXT", steps: ["CURRENT_V3_STEPS"] };
  const params = new URLSearchParams();
  writeChatEntryContext(params, { source: "paper", paperId: initial.papers[0].id, questionId: original.id, questionVersion: 2 });
  const opened = applyAction(initial, { action: "chat.open", context: readChatEntryContext(params) }, ctx);
  const thread = opened.state.companion.threads[0];
  const html = render(CompanionContextCard, { thread });
  assert.match(html, /原卷冻结题目.*v2/); assert.match(html, /ORIGINAL_V2_TEXT/);
  assert.doesNotMatch(html, /CURRENT_V3|SECRET_V2_ANSWER|ORIGINAL_V2_STEPS/);
  const sent = applyAction(opened.state, { action: "chat.send", ...chatSendPayload(thread.id, "explanation", "", "explicit-help", 0) }, ctx);
  assert.match(sent.state.messages.at(-1).text, /ORIGINAL_V2_STEPS/);
  assert.doesNotMatch(sent.state.messages.at(-1).text, /CURRENT_V3/);
});

test("route round trips are explicit, do not carry answers and reject missing version/source", () => {
  for (const context of [{ source: "general" }, { source: "bank", questionId: "q-a", questionVersion: 3 }, { source: "paper", paperId: "p-a", questionId: "q-a", questionVersion: 2 }]) {
    const params = new URLSearchParams(); writeChatEntryContext(params, context);
    assert.deepEqual(readChatEntryContext(params), context);
    assert.doesNotMatch(params.toString(), /answer|steps|hint|snapshot/);
  }
  for (const query of ["chatSource=bank&questionId=q", "chatSource=paper&questionId=q&questionVersion=2", "chatSource=bank&questionId=q&questionVersion=-1", "chatSource=other&questionId=q&questionVersion=2"]) assert.throws(() => readChatEntryContext(new URLSearchParams(query)), /入口/);
  assert.equal(readChatEntryContext(new URLSearchParams("id=legacy-q")), undefined);
});

test("cache identity is scoped to workspace, actor and thread without ambiguous separators", () => {
  const { state, thread } = fixture();
  state.access = { workspaceId: "space-one", ownerId: ctx.userId, role: "student", workspaces: [] };
  const key = chatDraftStorageKey(state, thread.id);
  assert.notEqual(key, chatDraftStorageKey({ ...state, actor: { ...state.actor, id: "someone-else" } }, thread.id));
  assert.notEqual(key, chatDraftStorageKey({ ...state, access: { ...state.access, workspaceId: "space-two" } }, thread.id));
  assert.notEqual(key, chatDraftStorageKey(state, "other-thread"));
});

test("cached text cannot revive deleted, invisible or other person's thread, even for owner", () => {
  const { state, thread } = fixture();
  const raw = JSON.stringify({ text: "PRIVATE_LOCAL_DRAFT", intent: "note" });
  assert.equal(recoverChatDraft(state, thread.id, raw).text, "PRIVATE_LOCAL_DRAFT");
  for (const role of ["parent", "teacher", "editor", "reviewer"]) assert.equal(recoverChatDraft({ ...state, actor: { ...state.actor, role } }, thread.id, raw), null);
  assert.equal(recoverChatDraft({ ...state, actor: { ...state.actor, role: "owner", id: "workspace-owner" } }, thread.id, raw), null);
  const deleted = { ...state, companion: { ...state.companion, threads: [] } };
  assert.equal(recoverChatDraft(deleted, thread.id, raw), null);
  const html = render(CompanionChat, { ...props(deleted), selectedId: thread.id });
  assert.match(html, /会话可能已删除/); assert.doesNotMatch(html, /PRIVATE_LOCAL_DRAFT/);
});

test("confirmed missing thread prunes only this viewer's workspace cache", () => {
  const { state, thread } = fixture();
  state.access = { workspaceId: "cache-scope", ownerId: "owner", role: "student", workspaces: [] };
  const own = chatDraftStorageKey(state, thread.id), stale = chatDraftStorageKey(state, "deleted-thread");
  const otherActor = chatDraftStorageKey({ ...state, actor: { ...state.actor, id: "different-actor" } }, "deleted-thread");
  const otherWorkspace = chatDraftStorageKey({ ...state, access: { ...state.access, workspaceId: "other-space" } }, "deleted-thread");
  const keys = [own, stale, otherActor, otherWorkspace, "unrelated-key", "xiaohe-chat-draft:bad-json"];
  assert.deepEqual(chatDraftKeysToPrune(state, keys), [stale]);
  assert.deepEqual(chatDraftKeysToPrune({ ...state, companion: { ...state.companion, threads: [] } }, keys), [own, stale]);
});

test("uncertain send recovers stable request payload, acknowledged send does not revive its old draft", () => {
  const { state, thread } = fixture();
  const request = { requestId: "lost-response", intent: "note", text: "保存这段输入", expectedDraftRevision: 0 };
  const raw = JSON.stringify({ text: request.text, intent: "note", request });
  assert.deepEqual(recoverChatDraft(state, thread.id, raw).request, request);
  const committed = applyAction(state, { action: "chat.send", threadId: thread.id, ...request }, ctx).state;
  assert.equal(recoverChatDraft(committed, thread.id, raw), null);
  const newer = JSON.stringify({ text: "另一个未发出的想法", intent: "note", request });
  assert.deepEqual(recoverChatDraft(committed, thread.id, newer), { text: "另一个未发出的想法", intent: "note" });
  for (const invalid of ["null", "{}", "invalid json", JSON.stringify({ text: "valid", intent: "note", request: { requestId: "bad" } })]) assert.equal(recoverChatDraft(state, thread.id, invalid), null);
});

test("general and legacy screens cannot request unbound help or guess legacy question sources", () => {
  const { state, thread } = fixture("general");
  const html = render(CompanionChat, { ...props(projectWorkspace(state, "student")), selectedId: thread.id });
  assert.match(html, /普通消息只记录问题/); assert.match(html, /当前没有题目，题库帮助按钮不可用/);
  for (const label of ["先给一点提示", "查看完整讲解", "查看其他方法"]) assert.match(html, new RegExp(`<button[^>]+disabled=""[^>]*>[\\s\\S]*?${label}`));
  const legacy = { ...thread, context: { source: "legacy" } };
  const legacyHtml = render(CompanionContextCard, { thread: legacy });
  assert.match(legacyHtml, /题目版本未知/); assert.doesNotMatch(legacyHtml, /原卷冻结|题库冻结/);
});

test("private role guard and own-thread filtering withstand accidentally supplied full state", () => {
  const { state, thread } = fixture();
  thread.context.questionText = "PRIVATE_CONTEXT"; thread.draft.text = "PRIVATE_DRAFT";
  state.messages.push({ id: "private-message", role: "user", threadId: thread.id, text: "PRIVATE_MESSAGE", createdAt: now });
  for (const role of ["teacher", "parent", "editor", "reviewer"]) {
    const restricted = { ...state, actor: { ...state.actor, role } };
    const html = render(CompanionChat, props(restricted));
    assert.match(html, /私人学习会话仅供本人查看/); assert.doesNotMatch(html, /PRIVATE_CONTEXT|PRIVATE_DRAFT|PRIVATE_MESSAGE/);
    assert.equal(render(CompanionPreferences, props(restricted)), "");
  }
  const owner = { ...state, actor: { ...state.actor, id: "other-owner", role: "owner" } };
  assert.doesNotMatch(render(CompanionChat, props(owner)), /PRIVATE_CONTEXT|PRIVATE_DRAFT|PRIVATE_MESSAGE/);
});

test("rendered message content is escaped and preference provenance is explicit", () => {
  const html = render(CompanionMessageList, { name: "学习者", messages: [{ id: "m", role: "assistant", text: "<script>PRIVATE_XSS</script>", createdAt: now, preferenceUsed: { key: "presentation", value: "compact", source: "self" } }] });
  assert.match(html, /&lt;script&gt;PRIVATE_XSS/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /简洁说明.*来源：本人设置/);
});

test("help preview contains only handwritten summary and safe context, with explicit sharing scope", () => {
  const { thread } = fixture();
  thread.snapshot.answer = "SECRET_ANSWER";
  const html = render(CompanionHelpPreview, { preview: { threadId: thread.id, requestId: "help-id", topic: "求助", summary: "<b>请帮我核对这一步</b>", context: thread.context } });
  assert.match(html, /&lt;b&gt;请帮我核对这一步/);
  assert.match(html, /已授权教师/); assert.match(html, /工作区所有者也可查看/);
  assert.match(html, /不附带私人会话全文、草稿或照片/); assert.doesNotMatch(html, /SECRET_ANSWER/);
});
