import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { createSeedWorkspace } from "../lib/seed.ts";
import * as domain from "../lib/server/domain.ts";
import { resolveAccess } from "../lib/server/memberships.ts";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import type { AccessContext } from "../lib/access-types";
import type { Role } from "../lib/types";
import * as fileAccess from "../lib/server/file-access.ts";

function loadModule(path: string, dependencies: Record<string, unknown>): Record<string, unknown> {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    return dependencies[specifier];
  }, loaded, loaded.exports);
  return loaded.exports;
}

function fixture() {
  const sql = new DatabaseSync(":memory:");
  const now = "2026-10-27T10:00:00.000Z";
  for (const file of ["0000_great_wallop.sql", "0001_melodic_alex_power.sql"]) sql.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  const state = createSeedWorkspace("owner-a", "学生甲", now);
  state.uploads = [{ id: "image-a", name: "原稿甲.png", url: "/api/files/image-a", status: "pending", purpose: "homework", createdAt: now }];
  state.evidenceReviews = { schemaVersion: 1, proposals: [{
    id: "proposal-a", evidenceId: "evidence-a", sourceDigest: "digest", patch: { answer: "14" }, reason: "录入遗漏",
    uploadIds: ["image-a"], requestedBy: "member-a", createdAt: now, createdRevision: 1,
    delivery: "workspace", requestId: "request-a", requestDigest: "digest",
  }], decisions: [] };
  sql.prepare("INSERT INTO workspaces(user_id, revision, state, created_at, updated_at) VALUES ('owner-a', 0, ?, ?, ?)").run(JSON.stringify(state), now, now);
  sql.prepare("INSERT INTO workspace_memberships(id, workspace_id, user_id, email, name, role, status, created_at) VALUES ('membership-a', 'owner-a', 'member-a', 'a@example.test', '成员甲', 'teacher', 'active', ?)").run(now);
  const db = { prepare(query: string) { return { bind(...values: (string | number | null)[]) { return { async first() { return sql.prepare(query).get(...values) ?? null; } }; } }; } } as unknown as Pick<D1Database, "prepare" | "batch">;
  let user: ChatGPTUser | null = { userId: "member-a", displayName: "成员甲", fullName: "成员甲", email: "a@example.test" };
  let requestedId = "";
  let reads = 0;
  let beforeObject: (() => void) | undefined;
  let objectAvailable = true;
  const env: { BUCKET?: { get: (key: string) => Promise<{ body: Uint8Array } | null> } } = {
    BUCKET: { async get(key) { reads++; assert.equal(key, "private/owner-a/image-a"); beforeObject?.(); return objectAvailable ? { body: new Uint8Array([137, 80, 78, 71]) } : null; } },
  };
  const route = loadModule("../app/api/evidence/[proposalId]/images/[uploadId]/route.ts", {
    "cloudflare:workers": { env },
    "drizzle-orm": { eq: (_column: unknown, id: string) => { requestedId = id; return id; } },
    "../../../../../chatgpt-auth": { getChatGPTUser: async () => user },
    "../../../../../../db": { getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ get: async () => requestedId === "image-a" ? {
      id: "image-a", userId: "owner-a", objectKey: "private/owner-a/image-a", filename: "原稿甲.png", mediaType: "image/png", size: 4,
    } : undefined }) }) }) }) },
    "../../../../../../db/schema": { uploadedFiles: { id: "id" } },
    "../../../../../../lib/server/http": loadModule("../lib/server/http.ts", { "./domain": domain }),
    "../../../../../../lib/server/memberships": { resolveAccess: (actor: ChatGPTUser, id?: string) => resolveAccess(actor, id, db) },
    "../../../../../../lib/server/file-access": fileAccess,
    "../../../../../../lib/server/store": { readWorkspace: async (actor: ChatGPTUser, access: AccessContext) => {
      const current = await resolveAccess(actor, access.workspaceId, db);
      assert.deepEqual(current, access); return structuredClone(state);
    } },
  });
  const GET = route.GET as (request: Request, context: { params: Promise<{ proposalId: string; uploadId: string }> }) => Promise<Response>;
  return {
    state, env, get reads() { return reads; }, close() { sql.close(); },
    role(role: Exclude<Role, "owner">) { sql.prepare("UPDATE workspace_memberships SET role=?").run(role); },
    revoke() { sql.prepare("UPDATE workspace_memberships SET status='revoked'").run(); },
    identity(id: string) { user = { ...user!, userId: id }; }, signOut() { user = null; },
    duringRead(callback: () => void) { beforeObject = callback; }, missingObject() { objectAvailable = false; },
    get(proposalId = "proposal-a", uploadId = "image-a", query = "", headers: Record<string, string> = {}) {
      return GET(new Request(`https://xiaohe.test/api/evidence/${proposalId}/images/${uploadId}${query}`, { headers }), { params: Promise.resolve({ proposalId, uploadId }) });
    },
  };
}

test("review image GET grants current teacher only the explicitly selected image with private headers", async () => {
  const f = fixture();
  try {
    const result = await f.get("proposal-a", "image-a", "?workspaceId=owner-a");
    assert.equal(result.status, 200); assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [137, 80, 78, 71]);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
    assert.equal(result.headers.get("content-type"), "image/png");
    assert.equal(result.headers.get("content-security-policy"), "default-src 'none'");
    assert.equal(f.reads, 1);
  } finally { f.close(); }
});

test("review image GET denies unrelated, non-teaching and revoked memberships before object read", async () => {
  const f = fixture();
  try {
    for (const role of ["parent", "editor", "reviewer"] as const) { f.role(role); assert.equal((await f.get()).status, 404); }
    f.role("teacher"); f.identity("unrelated"); assert.equal((await f.get()).status, 404);
    f.identity("member-a"); f.revoke(); assert.equal((await f.get()).status, 404);
    assert.equal(f.reads, 0);
  } finally { f.close(); }
});

test("review image GET denies unselected, missing metadata, local-only and guessed proposal materials", async () => {
  const f = fixture();
  try {
    assert.equal((await f.get("proposal-other")).status, 404);
    assert.equal((await f.get("proposal-a", "image-other")).status, 404);
    f.state.evidenceReviews!.proposals[0].uploadIds = []; assert.equal((await f.get()).status, 404);
    f.state.evidenceReviews!.proposals[0].uploadIds = ["image-a"];
    f.state.evidenceReviews!.proposals[0].delivery = "local-only"; assert.equal((await f.get()).status, 404);
    f.state.evidenceReviews!.proposals[0].delivery = "workspace";
    f.state.uploads = []; assert.equal((await f.get()).status, 404);
    assert.equal(f.reads, 0);
  } finally { f.close(); }
});

test("review image GET permits owner and requesting student but denies a different student's proposal", async () => {
  const f = fixture();
  try {
    f.role("student"); assert.equal((await f.get()).status, 200);
    f.state.evidenceReviews!.proposals[0].requestedBy = "student-other"; assert.equal((await f.get()).status, 404);
    f.identity("owner-a"); assert.equal((await f.get()).status, 200);
  } finally { f.close(); }
});

test("review image GET rejects ambiguous selectors, cross-site use and signed-out clients", async () => {
  const f = fixture();
  try {
    assert.equal((await f.get("proposal-a", "image-a", "?workspaceId=owner-b")).status, 404);
    assert.equal((await f.get("proposal-a", "image-a", "?workspaceId=owner-a&workspaceId=owner-a")).status, 400);
    assert.equal((await f.get("proposal-a", "image-a", "", { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await f.get("proposal-a", "image-a", "", { origin: "https://elsewhere.test" })).status, 403);
    assert.equal((await f.get("invalid proposal")).status, 404);
    f.signOut(); assert.equal((await f.get()).status, 401);
    assert.equal(f.reads, 0);
  } finally { f.close(); }
});

test("review image GET rechecks membership after object I/O", async () => {
  for (const change of ["revoke", "role"] as const) {
    const f = fixture();
    try {
      f.duringRead(() => change === "revoke" ? f.revoke() : f.role("parent"));
      const response = await f.get(); assert.equal(response.status, 404);
      assert.equal(f.reads, 1); assert.doesNotMatch(await response.text(), /PNG|private\/owner-a/);
    } finally { f.close(); }
  }
});

test("review image GET handles missing bucket/object without leaking internal identifiers", async () => {
  const f = fixture();
  try {
    f.missingObject(); assert.equal((await f.get()).status, 404);
    delete f.env.BUCKET; assert.equal((await f.get()).status, 404);
    assert.equal(f.reads, 1);
  } finally { f.close(); }
});

test("review image GET denies deletion or revoked material selection during object I/O", async () => {
  for (const change of ["upload", "proposal", "selection"] as const) {
    const f = fixture();
    try {
      f.duringRead(() => {
        if (change === "upload") f.state.uploads = [];
        else if (change === "proposal") f.state.evidenceReviews!.proposals = [];
        else f.state.evidenceReviews!.proposals[0].uploadIds = [];
      });
      assert.equal((await f.get()).status, 404); assert.equal(f.reads, 1);
    } finally { f.close(); }
  }
});
