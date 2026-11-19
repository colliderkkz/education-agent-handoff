import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { mergedQuestions, stageOfKnowledge, subjectOfKnowledge } from "../lib/types.ts";

const question = (knowledgeId: string) => ({ id: knowledgeId, familyId: knowledgeId, version: 1, knowledgeId, text: "题目", answer: "1", unit: "", source: "原创", sourceScope: "练习", steps: [], hint: "", alternative: "", prerequisites: [], status: "published" });
const questions = [question("math-1-place"), question("math-j-1-real"), question("math-j-1-factor"), question("math-s-1-function")];
function route(role: string, workspaceQuestions: ReturnType<typeof question>[] = []) {
  const source = readFileSync(new URL("../app/api/content-bank/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps: Record<string, unknown> = {
    "../../chatgpt-auth": { getChatGPTUser: async () => ({ userId: "test" }) },
    "../../../lib/content-bank": { loadContentBank: () => ({ version: "test", digest: "", questions }) },
    "../../../lib/server/memberships": { resolveAccess: async (_user: unknown, workspaceId?: string) => ({ role, workspaceId }) },
    "../../../lib/server/store": { readWorkspace: async (_user: unknown, access: { role: string; workspaceId?: string }) => { assert.notEqual(access.role, "student"); return { questions: workspaceQuestions }; } },
    "../../../lib/server/http": { json: (body: unknown, status = 200) => Response.json(body, { status }), requestWorkspaceId: (request: Request) => new URL(request.url).searchParams.get("workspaceId") ?? undefined, errorResponse: () => Response.json({ error: "failed" }, { status: 500 }) },
    "@/lib/types": { mergedQuestions, stageOfKnowledge, subjectOfKnowledge },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((name: string) => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, mod, mod.exports);
  return (mod.exports as { GET(request: Request): Promise<Response> }).GET;
}

test("bank stage filter returns only questions from the selected school stage", async () => {
  const get = route("owner");
  for (const [stage, id] of [["primary", "math-1-place"], ["junior", "math-j-1-real"], ["senior", "math-s-1-function"]]) {
    const response = await get(new Request(`https://example.test/api/content-bank?stage=${stage}`));
    assert.equal(response.status, 200);
    const body = await response.json() as { total: number; items: Array<{ id: string }> };
    assert.equal(body.total, stage === "junior" ? 2 : 1); assert.equal(body.items[0].id, id);
  }
  assert.equal((await get(new Request("https://example.test/api/content-bank?stage=invalid"))).status, 400);
  assert.equal((await route("student")(new Request("https://example.test/api/content-bank?stage=junior"))).status, 403);
});

test("the question library merges published workspace items without exposing drafts or disabled overrides", async () => {
  const own = { ...question("math-j-1-real"), id: "workspace-published", familyId: "own" };
  const draft = { ...question("math-j-1-real"), id: "workspace-draft", status: "draft" };
  const disabled = { ...question("math-s-1-function"), status: "disabled" };
  const get = route("owner", [own, draft, disabled]);
  const response = await get(new Request("https://example.test/api/content-bank?workspaceId=workspace-a"));
  const body = await response.json() as { total: number; items: Array<{ id: string; fromWorkspace: boolean }> };
  assert.equal(response.status, 200);
  assert.equal(body.total, 4);
  assert.ok(body.items.some(item => item.id === "workspace-published" && item.fromWorkspace));
  assert.ok(!body.items.some(item => item.id === "workspace-draft" || item.id === "math-s-1-function"));
  assert.ok(body.items.some(item => item.id === "math-j-1-real" && !item.fromWorkspace));
});

test("multiple knowledge points are combined and still respect the selected stage", async () => {
  const get = route("owner");
  const response = await get(new Request("https://example.test/api/content-bank?stage=junior&point=math-j-1-real&point=math-j-1-factor&point=math-s-1-function&point=math-j-1-real"));
  const body = await response.json() as { total: number; items: Array<{ id: string }> };
  assert.equal(response.status, 200);
  assert.equal(body.total, 2);
  assert.deepEqual(body.items.map(item => item.id), ["math-j-1-real", "math-j-1-factor"]);
  const single = await get(new Request("https://example.test/api/content-bank?point=math-j-1-factor"));
  assert.equal((await single.json() as { total: number }).total, 1);
  const all = await get(new Request("https://example.test/api/content-bank?point="));
  assert.equal((await all.json() as { total: number }).total, 4);
});
