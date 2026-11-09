import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { createSeedWorkspace } from "../lib/seed.ts";
import * as domain from "../lib/server/domain.ts";
import * as fileAccess from "../lib/server/file-access.ts";
import * as history from "../lib/server/history.ts";
import { projectWorkspace } from "../lib/server/access-policy.ts";
import type { ApiResult, HistoryDeletionPreview, WorkspaceState } from "../lib/types";
import type { HistoryFileGcDependencies, SupersededUploadDependencies, UnindexedUploadDependencies } from "../lib/server/history-file-gc";

function load(path: string, dependencies: Record<string, unknown>): Record<string, unknown> {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", source)((name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; }, loaded, loaded.exports);
  return loaded.exports;
}
const NOW = "2026-10-27T10:00:00.000Z";
let serial = 0;
const context = { userId: "file-owner", displayName: "测试学生", role: "owner" as const, now: NOW, newId: () => `history-file-test-${++serial}` };
const user = { userId: "file-owner", displayName: "测试学生", email: "file@example.test" };
const access = { workspaceId: user.userId, ownerId: user.userId, role: "owner" as const };
const http = load("../lib/server/http.ts", { "./domain": domain });
function seed() {
  const state = createSeedWorkspace(user.userId, user.displayName, NOW);
  state.uploads = [{ id: "photo-one", name: "材料.png", url: "/api/files/photo-one", createdAt: NOW, status: "pending", purpose: "homework" }];
  return state;
}
function deleted(current = seed()) {
  const selection = { evidenceIds: [current.evidence[0].id], uploadIds: ["photo-one"] };
  const preview = domain.applyAction(current, { action: "history.delete.preview", ...selection }, context).result!.preview as HistoryDeletionPreview;
  return domain.applyAction(current, { action: "history.delete.confirm", ...selection, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: `delete-test-${++serial}` }, context).state;
}
const gcModule = load("../lib/server/history-file-gc.ts", {
  "cloudflare:workers": { env: {} }, "drizzle-orm": {}, "../../db": {}, "../../db/schema": {},
  "./domain-error": { DomainError: domain.DomainError }, "./store": {}, "./history": history,
});
const gc = gcModule.collectHistoryFiles as (ownerId: string, dependencies: HistoryFileGcDependencies) => Promise<WorkspaceState>;
const unindexedGc = gcModule.collectUnindexedUploads as (ownerId: string, dependencies: UnindexedUploadDependencies) => Promise<number>;
const stagedGc = gcModule.collectSupersededUploads as (ownerId: string, dependencies: SupersededUploadDependencies) => Promise<number>;

function gcFixture() {
  let state = deleted();
  const file = { id: "photo-one", userId: user.userId, objectKey: "server-private-key" };
  let indexed = true, object = true, failed = "", reads = 0;
  const calls: string[] = [];
  const dependencies: HistoryFileGcDependencies = {
    async read() { reads++; if (failed === "revoked" && reads > 1) throw new domain.DomainError("授权已撤销", 403); return structuredClone(state); },
    async findFile() { return indexed ? file : undefined; },
    async deleteObject(key) { calls.push(`object:${key}`); if (failed === "object") throw new Error("R2 unavailable"); object = false; },
    async deleteIndex(id) { calls.push(`index:${id}`); if (failed === "index") throw new Error("D1 unavailable"); indexed = false; },
    async acknowledge(ids) { calls.push("ack"); if (failed === "ack") throw new Error("ack unavailable"); state = history.completeHistoryFileTasks(state, ids, { now: NOW }).state; if (failed === "ack-unknown") throw new Error("ack reply lost"); },
  };
  return { dependencies, calls, file, get state() { return state; }, get indexed() { return indexed; }, get object() { return object; }, fail(value: string) { failed = value; }, setState(value: WorkspaceState) { state = value; } };
}

test("committed photo GC removes the indexed server key then index then acknowledges exactly once", async () => {
  const f = gcFixture(), before = f.state.revision;
  const result = await gc(user.userId, f.dependencies);
  assert.deepEqual(f.calls, ["object:server-private-key", "index:photo-one", "ack"]);
  assert.equal(result.historyDeletion!.fileTasks[0].status, "complete"); assert.equal(result.revision, before + 1);
  assert.equal(f.object, false); assert.equal(f.indexed, false);
  await gc(user.userId, f.dependencies); assert.equal(f.calls.length, 3);
});

test("R2 failure keeps a durable pending task and index while both photo access paths remain revoked", async () => {
  const f = gcFixture(); f.fail("object");
  const result = await gc(user.userId, f.dependencies);
  assert.equal(result.historyDeletion!.fileTasks[0].status, "pending"); assert.equal(f.indexed, true); assert.equal(f.object, true);
  assert.equal(fileAccess.availableUpload(result, "photo-one"), false);
  assert.equal(fileAccess.availableReviewImage(result, "old-proposal", "photo-one", "teacher", "teacher"), false);
  f.fail(""); await gc(user.userId, f.dependencies); assert.equal(f.state.historyDeletion!.fileTasks[0].status, "complete");
});

test("index and acknowledgement failures can replay without restoring the object or deleting another file", async () => {
  for (const failure of ["index", "ack", "ack-unknown"]) {
    const f = gcFixture(); f.fail(failure); await gc(user.userId, f.dependencies);
    assert.equal(f.object, false); f.fail(""); await gc(user.userId, f.dependencies);
    assert.equal(f.state.historyDeletion!.fileTasks[0].status, "complete");
    assert.ok(f.calls.every(call => ["object:server-private-key", "index:photo-one", "ack"].includes(call)));
  }
});

test("GC only executes durable tasks for the authorized owner and stops on revoked access", async () => {
  const f = gcFixture(); f.file.userId = "another-owner"; await gc(user.userId, f.dependencies); assert.deepEqual(f.calls, []);
  f.file.userId = user.userId; f.fail("revoked"); await assert.rejects(gc(user.userId, f.dependencies), /授权已撤销/); assert.deepEqual(f.calls, []);
  const g = gcFixture(); g.setState(seed()); await gc(user.userId, g.dependencies); assert.deepEqual(g.calls, []);
});

test("deleted upload aliases remain inaccessible even if a stale registration is reintroduced", () => {
  const state = deleted(); state.uploads.push({ id: "new-alias", name: "旧材料", url: "/api/files/photo-one", createdAt: NOW, status: "pending", purpose: "homework" });
  assert.equal(fileAccess.availableUpload(state, "new-alias"), false);
});

function imageFixture() {
  let state = seed(), role = "owner", revoked = false, beforeGet: (() => void) | undefined, gets = 0;
  const route = load("../app/api/files/[id]/route.ts", {
    "cloudflare:workers": { env: { BUCKET: { async get() { gets++; beforeGet?.(); return { body: new Uint8Array([1, 2, 3]) }; } } } },
    "drizzle-orm": { eq: () => null }, "../../../chatgpt-auth": { getChatGPTUser: async () => user },
    "../../../../db": { getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ get: async () => ({ id: "photo-one", userId: user.userId, objectKey: "private-key", filename: "图.png", mediaType: "image/png", size: 3 }) }) }) }) }) },
    "../../../../db/schema": { uploadedFiles: {} }, "../../../../lib/server/http": http,
    "../../../../lib/server/memberships": { resolveAccess: async () => { if (revoked) throw new Error("revoked"); return { ...access, role }; } },
    "../../../../lib/server/store": { readWorkspace: async () => { if (revoked || role !== "owner") throw new Error("access changed"); return structuredClone(state); } },
    "../../../../lib/server/file-access": fileAccess,
  }).GET as (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  return { get reads() { return gets; }, role(value: string) { role = value; }, revoke() { revoked = true; }, remove() { state = deleted(state); }, duringRead(callback: () => void) { beforeGet = callback; }, get(query = "") { return route(new Request(`https://xiaohe.test/api/files/photo-one${query}`), { params: Promise.resolve({ id: "photo-one" }) }); } };
}

test("ordinary image GET checks active registration and role before R2 I/O", async () => {
  const f = imageFixture(); for (const role of ["parent", "teacher", "editor", "reviewer"]) { f.role(role); assert.equal((await f.get()).status, 404); }
  f.role("owner"); assert.equal((await f.get("?workspaceId=another")).status, 404);
  f.remove(); assert.equal((await f.get()).status, 404); assert.equal(f.reads, 0);
});

test("ordinary image GET rechecks deletion and access after R2 I/O, keeping private cache headers on success", async () => {
  for (const change of ["delete", "revoke"]) {
    const f = imageFixture(); f.duringRead(() => change === "delete" ? f.remove() : f.revoke()); assert.equal((await f.get()).status, 404); assert.equal(f.reads, 1);
  }
  const f = imageFixture(); const result = await f.get(); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "private, no-store");
});

function uploadFixture() {
  let state = seed(), beforePut: (() => void | Promise<void>) | undefined, unknown = false, failDelete = false, failInsert = false;
  const files = new Map<string, Record<string, unknown>>(), objects = new Set<string>(), metadata = new Map<string, Record<string, string>>();
  const db = { insert: () => ({ values: async (record: Record<string, unknown>) => { if (failInsert) throw new Error("index insert failed"); files.set(String(record.id), record); } }), delete: () => ({ where: async (conditions: { value: string }[]) => { files.delete(conditions[0].value); } }) };
  const route = load("../app/api/upload/route.ts", {
    "cloudflare:workers": { env: { BUCKET: { async put(key: string, _bytes: unknown, options: { customMetadata: Record<string, string> }) { await beforePut?.(); objects.add(key); metadata.set(key, options.customMetadata); }, async delete(key: string) { if (failDelete) throw new Error("R2 cleanup failed"); objects.delete(key); } } } },
    "drizzle-orm": { eq: (_: unknown, value: string) => ({ value }), and: (...values: unknown[]) => values },
    "../../chatgpt-auth": { getChatGPTUser: async () => user }, "../../../db": { getDb: () => db }, "../../../db/schema": { uploadedFiles: {} },
    "../../../lib/server/store": { readWorkspace: async () => structuredClone(state), changeWorkspace: async (_: unknown, change: (value: WorkspaceState) => ApiResult) => { const result = change(structuredClone(state)); state = result.state; if (unknown) throw new Error("save reply lost"); return result; } },
    "../../../lib/server/domain": domain, "../../../lib/server/http": http,
    "../../../lib/server/memberships": { resolveAccess: async () => access }, "../../../lib/server/access-policy": { projectWorkspace },
  }).POST as (request: Request) => Promise<Response>;
  return { files, objects, metadata, failIndex() { failInsert = true; }, get state() { return state; }, afterDeletion() { state = deleted(state); }, failCleanup() { failDelete = true; }, duringPut(callback: () => void | Promise<void>) { beforePut = callback; }, deleteDuringPut() { beforePut = () => { state = deleted(state); }; }, unknownCommit() { unknown = true; }, async post() { const form = new FormData(); form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], "新图.png", { type: "image/png" })); form.set("purpose", "single"); return route(new Request("https://xiaohe.test/api/upload", { method: "POST", headers: { origin: "https://xiaohe.test" }, body: form })); } };
}

test("an upload that started before a deletion cannot register after that deletion", async () => {
  const f = uploadFixture(); f.deleteDuringPut(); const result = await f.post();
  assert.equal(result.status, 409); assert.match(await result.text(), /上传期间学习历史发生删除/); assert.equal(f.files.size, 0); assert.equal(f.objects.size, 0); assert.equal(f.state.uploads.length, 0);
});

test("unknown upload commit is recovered without deleting the saved new object", async () => {
  const f = uploadFixture(); f.unknownCommit(); const response = await f.post(); assert.equal(response.status, 201);
  assert.equal(f.files.size, 1); assert.equal(f.objects.size, 1); assert.equal(f.state.uploads.length, 2);
});

test("new upload after a completed deletion is kept independently of prior cleanup tasks", async () => {
  const f = uploadFixture(); f.deleteDuringPut(); await f.post();
  // A new request takes a fresh deletion epoch; its unrelated image may save.
  const g = uploadFixture(); g.afterDeletion(); const response = await g.post(); assert.equal(response.status, 201); assert.equal(g.objects.size, 1); assert.equal(g.state.uploads.length, 1); assert.equal(g.state.historyDeletion!.fileTasks[0].status, "pending");
});

test("GC before a late PUT cannot lose its index: failed compensation is discoverable on the next retry", async () => {
  const f = uploadFixture();
  const cleaned: string[] = [];
  const dependencies: SupersededUploadDependencies = {
    read: async () => f.state,
    listFiles: async () => [...f.files.values()] as unknown as Awaited<ReturnType<SupersededUploadDependencies["listFiles"]>>,
    deleteObject: async key => { cleaned.push(key); f.objects.delete(key); },
    deleteIndex: async id => { f.files.delete(id); },
  };
  f.duringPut(async () => {
    f.afterDeletion();
    assert.equal(await stagedGc(user.userId, dependencies), 0);
    assert.equal(f.files.size, 0, "the unfinished PUT has no GC-visible index");
  });
  f.failCleanup(); const result = await f.post(); assert.equal(result.status, 409);
  assert.equal(f.files.size, 1, "failed compensation retains the completed PUT's index"); assert.equal(f.objects.size, 1);
  const key = [...f.objects][0]; assert.equal(await stagedGc(user.userId, dependencies), 0);
  assert.deepEqual(cleaned, [key]); assert.equal(f.files.size, 0); assert.equal(f.objects.size, 0);
});

test("staged GC preserves still-registered, newer-epoch, foreign and separately scheduled files", async () => {
  const state = deleted(); state.uploads.push({ id: "retained", name: "保留", url: "/api/files/retained", createdAt: NOW, status: "pending", purpose: "single" });
  const files = [
    { id: "retained", userId: user.userId, objectKey: "keep-registered", historyEpoch: 0 },
    { id: "newer", userId: user.userId, objectKey: "keep-newer", historyEpoch: state.revision },
    { id: "foreign", userId: "elsewhere", objectKey: "keep-foreign", historyEpoch: 0 },
    { id: "photo-one", userId: user.userId, objectKey: "separate-task", historyEpoch: 0 },
    { id: "superseded", userId: user.userId, objectKey: "remove-old-staged", historyEpoch: 0 },
  ];
  const deletedKeys: string[] = [];
  const dependencies = { read: async () => state, listFiles: async () => files, deleteObject: async (key: string) => { deletedKeys.push(key); }, deleteIndex: async (id: string) => { files.splice(files.findIndex(file => file.id === id), 1); } };
  assert.equal(await stagedGc(user.userId, dependencies), 0); assert.deepEqual(deletedKeys, ["remove-old-staged"]);
});

test("history upload migration preserves existing records and gives prior uploads epoch zero", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../drizzle/0000_great_wallop.sql", import.meta.url), "utf8"));
    db.prepare("INSERT INTO uploaded_files(id,user_id,object_key,filename,media_type,size,purpose,created_at) VALUES ('old','owner','private/old','旧照片','image/png',4,'single',?)").run(NOW);
    db.exec(readFileSync(new URL("../drizzle/0002_history_upload_fence.sql", import.meta.url), "utf8"));
    const row = db.prepare("SELECT filename,history_epoch FROM uploaded_files WHERE id='old'").get(); assert.equal(row!.filename, "旧照片"); assert.equal(row!.history_epoch, 0);
  } finally { db.close(); }
});

test("successful PUT with failed index insert and failed compensation remains recoverable from server metadata", async () => {
  const f = uploadFixture(); f.deleteDuringPut(); f.failIndex(); f.failCleanup();
  assert.equal((await f.post()).status, 503); assert.equal(f.objects.size, 1); assert.equal(f.files.size, 0);
  const removed: string[] = [];
  const remaining = await unindexedGc(user.userId, {
    read: async () => f.state, indexed: async id => f.files.has(id),
    list: async () => ({ objects: [...f.objects].map(key => ({ key, customMetadata: f.metadata.get(key) })), truncated: false }),
    deleteObject: async key => { removed.push(key); f.objects.delete(key); }, deleteIndex: async id => { f.files.delete(id); },
  });
  assert.equal(remaining, 0); assert.equal(removed.length, 1); assert.equal(f.objects.size, 0);
});

test("unindexed recovery fully scans pages, rejects mismatched metadata and preserves current/aliased uploads", async () => {
  const state = deleted(), keys: string[] = [], cursors: (string | undefined)[] = [];
  const objects = Array.from({ length: 7 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    return { key: `private/${user.userId}/${id}`, customMetadata: { owner: user.userId, uploadId: id, historyEpoch: "0" } };
  });
  state.uploads.push({ id: "retained-alias", url: `/api/files/${objects[0].customMetadata.uploadId}`, name: "保留原图", createdAt: NOW, purpose: "single", status: "pending" });
  objects[1].customMetadata.owner = "another-owner"; objects[2].key = "private/another-owner/arbitrary";
  objects[3].customMetadata.historyEpoch = String(state.revision); objects[4].customMetadata.historyEpoch = "not-an-epoch";
  const dependencies: UnindexedUploadDependencies = {
    read: async () => state, indexed: async id => id === objects[5].customMetadata.uploadId,
    list: async cursor => { cursors.push(cursor); return cursor ? { objects: [objects[6]], truncated: false } : { objects: objects.slice(0, 6), truncated: true, cursor: "second-page" }; },
    deleteObject: async key => { keys.push(key); }, deleteIndex: async () => {},
  };
  assert.equal(await unindexedGc(user.userId, dependencies), 0); assert.deepEqual(cursors, [undefined, "second-page"]); assert.deepEqual(keys, [objects[6].key]);
});

test("unindexed recovery never reports completion after listing failure or incomplete pagination and retries failed deletion", async () => {
  const state = deleted(), id = "00000000-0000-4000-8000-000000000009";
  const object = { key: `private/${user.userId}/${id}`, customMetadata: { owner: user.userId, uploadId: id, historyEpoch: "0" } };
  const dependencies: UnindexedUploadDependencies = { read: async () => state, indexed: async () => false, list: async () => ({ objects: [object], truncated: false }), deleteObject: async () => { throw new Error("R2 unavailable"); }, deleteIndex: async () => { assert.fail("must retain recovery authority"); } };
  assert.equal(await unindexedGc(user.userId, dependencies), 1);
  await assert.rejects(unindexedGc(user.userId, { ...dependencies, list: async () => { throw new Error("listing unavailable"); } }), /listing unavailable/);
  await assert.rejects(unindexedGc(user.userId, { ...dependencies, list: async () => ({ objects: [], truncated: true }) }), /扫描未完整/);
  let listed = false;
  await assert.rejects(unindexedGc(user.userId, { ...dependencies, read: async () => { if (listed) throw new Error("access revoked"); return state; }, list: async () => { listed = true; return { objects: [object], truncated: false }; } }), /access revoked/);
});
