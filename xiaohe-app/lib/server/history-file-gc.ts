import { env } from "cloudflare:workers";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../../db";
import { uploadedFiles } from "../../db/schema";
import type { ChatGPTUser } from "../../app/chatgpt-auth";
import type { AccessContext } from "../access-types";
import type { WorkspaceState } from "../types";
import { DomainError } from "./domain-error";
import { changeWorkspace, readWorkspace } from "./store";
import { completeHistoryFileTasks } from "./history";

export interface HistoryFileGcDependencies {
  read: () => Promise<WorkspaceState>;
  findFile: (id: string) => Promise<{ id: string; userId: string; objectKey: string } | undefined>;
  deleteObject: (key: string) => Promise<void>;
  deleteIndex: (id: string) => Promise<void>;
  acknowledge: (ids: string[]) => Promise<void>;
}
export interface SupersededUploadDependencies {
  read: () => Promise<WorkspaceState>;
  listFiles: () => Promise<{ id: string; userId: string; objectKey: string; historyEpoch: number }[]>;
  deleteObject: (key: string) => Promise<void>;
  deleteIndex: (id: string) => Promise<void>;
}
export interface UnindexedUploadDependencies {
  read: () => Promise<WorkspaceState>;
  list: (cursor?: string) => Promise<{ objects: { key: string; customMetadata?: Record<string, string> }[]; truncated: boolean; cursor?: string }>;
  readMetadata?: (key: string) => Promise<Record<string, string> | undefined>;
  indexed: (id: string) => Promise<boolean>;
  deleteObject: (key: string) => Promise<void>;
  deleteIndex: (id: string) => Promise<void>;
}
const deletionEpoch = (state: WorkspaceState) => Math.max(0, ...(state.historyDeletion?.operations ?? []).map(operation => operation.appliedRevision));
const referencedUpload = (state: WorkspaceState, id: string) => state.uploads.some(upload => upload.id === id || upload.url === `/api/files/${id}`);

/** Recover PUT-success / index-write-failure objects. Only server-authored
 * metadata and an exact private owner/UUID key can establish cleanup authority.
 * Finish every listing page; an error never becomes a false zero-pending result. */
export async function collectUnindexedUploads(ownerId: string, dependencies: UnindexedUploadDependencies): Promise<number> {
  let cursor: string | undefined, pending = 0;
  const seen = new Set<string>(), prefix = `private/${encodeURIComponent(ownerId)}/`;
  do {
    await dependencies.read();
    const page = await dependencies.list(cursor);
    for (const object of page.objects) {
      const keyId = object.key.startsWith(prefix) ? object.key.slice(prefix.length) : "";
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(keyId)) continue;
      const metadata = object.customMetadata ?? await dependencies.readMetadata?.(object.key), id = metadata?.uploadId, epochText = metadata?.historyEpoch;
      if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
        || object.key !== `${prefix}${id}` || metadata?.owner !== ownerId || !epochText || !/^(0|[1-9]\d*)$/.test(epochText)) continue;
      const epoch = Number(epochText), state = await dependencies.read();
      if (!Number.isSafeInteger(epoch) || epoch >= deletionEpoch(state) || referencedUpload(state, id)
        || state.historyDeletion?.fileTasks.some(task => task.uploadId === id) || await dependencies.indexed(id)) continue;
      // A concurrent upload may have registered while the index lookup awaited.
      const current = await dependencies.read();
      if (epoch >= deletionEpoch(current) || referencedUpload(current, id) || current.historyDeletion?.fileTasks.some(task => task.uploadId === id)) continue;
      try { await dependencies.deleteObject(object.key); await dependencies.deleteIndex(id); }
      catch { pending++; /* R2 metadata survives a failed delete and is listed again. */ }
    }
    if (!page.truncated) break;
    if (!page.cursor || seen.has(page.cursor)) throw new DomainError("图片回收扫描未完整结束，请稍后重试", 503);
    seen.add(page.cursor); cursor = page.cursor;
  } while (true);
  return pending;
}

/** Rows are created only AFTER PUT has resolved successfully. Thus an older
 * epoch's unregistered row cannot be followed by a late write to this same key. */
export async function collectSupersededUploads(ownerId: string, dependencies: SupersededUploadDependencies): Promise<number> {
  const pending = async () => {
    const current = await dependencies.read(), epoch = deletionEpoch(current);
    return (await dependencies.listFiles()).filter(file => file.userId === ownerId && file.historyEpoch < epoch
      && !referencedUpload(current, file.id) && !current.historyDeletion?.fileTasks.some(task => task.uploadId === file.id));
  };
  for (const file of (await pending()).slice(0, 20)) {
    const current = await dependencies.read();
    if (file.historyEpoch >= deletionEpoch(current) || referencedUpload(current, file.id) || current.historyDeletion?.fileTasks.some(task => task.uploadId === file.id)) continue;
    try { await dependencies.deleteObject(file.objectKey); await dependencies.deleteIndex(file.id); }
    catch { /* Retain the post-PUT index as durable retry authority. */ }
  }
  return (await pending()).length;
}

/** Only committed tasks are executable. Every retry resolves keys from the
 * server-owned file index; caller supplied URLs/keys are never used for R2. */
export async function collectHistoryFiles(ownerId: string, dependencies: HistoryFileGcDependencies): Promise<WorkspaceState> {
  const initial = await dependencies.read();
  const tasks = (initial.historyDeletion?.fileTasks ?? []).filter(task => task.status === "pending").slice(0, 20);
  for (const scheduled of tasks) {
    // This recheck also stops a caller whose membership was revoked during I/O.
    const current = await dependencies.read();
    const task = current.historyDeletion?.fileTasks.find(item => item.id === scheduled.id && item.status === "pending");
    if (!task || current.uploads.some(upload => upload.id === task.uploadId)) continue;
    try {
      const file = await dependencies.findFile(task.uploadId);
      if (file && (file.id !== task.uploadId || file.userId !== ownerId)) continue;
      if (file) {
        await dependencies.deleteObject(file.objectKey);
        // Do not discard the durable index until object deletion succeeds. A
        // lost response is safe: object DELETE is idempotent on the next retry.
        await dependencies.deleteIndex(file.id);
      }
      await dependencies.acknowledge([task.id]);
    } catch {
      // Logical revocation remains committed. Keep the task pending if any
      // physical cleanup/ack failed, including an unknown commit outcome.
    }
  }
  return dependencies.read();
}

export async function retryHistoryFiles(user: ChatGPTUser, access: AccessContext): Promise<{ state: WorkspaceState; pendingUploads: number }> {
  if (access.role !== "owner" && access.role !== "student") throw new DomainError("当前角色不能清理学习历史文件", 403);
  const io = {
    read: () => readWorkspace(user, access),
    deleteObject: async (key: string) => { if (!env.BUCKET) throw new DomainError("文件存储暂不可用，请稍后重试回收", 503); await env.BUCKET.delete(key); },
    deleteIndex: async (id: string) => { await getDb().delete(uploadedFiles).where(and(eq(uploadedFiles.id, id), eq(uploadedFiles.userId, access.ownerId))); },
  };
  await collectHistoryFiles(access.ownerId, {
    ...io, findFile: id => getDb().select().from(uploadedFiles).where(eq(uploadedFiles.id, id)).get(),
    acknowledge: async ids => { await changeWorkspace(user, state => completeHistoryFileTasks(state, ids, { now: new Date().toISOString() }), access); },
  });
  let pendingUploads = await collectSupersededUploads(access.ownerId, {
    ...io, listFiles: async () => {
      const state = await io.read();
      return getDb().select().from(uploadedFiles).where(and(eq(uploadedFiles.userId, access.ownerId), lt(uploadedFiles.historyEpoch, deletionEpoch(state))));
    },
  });
  const current = await io.read();
  if (deletionEpoch(current) > 0) pendingUploads += await collectUnindexedUploads(access.ownerId, {
    ...io,
    list: async cursor => {
      if (!env.BUCKET) throw new DomainError("图片存储暂不可用，无法确认回收范围，请稍后重试", 503);
      return env.BUCKET.list({ prefix: `private/${encodeURIComponent(access.ownerId)}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
    },
    readMetadata: async key => {
      if (!env.BUCKET) throw new DomainError("图片存储暂不可用，请稍后重试", 503);
      return (await env.BUCKET.head(key))?.customMetadata;
    },
    indexed: async id => Boolean(await getDb().select({ id: uploadedFiles.id }).from(uploadedFiles).where(eq(uploadedFiles.id, id)).get()),
  });
  return { state: await io.read(), pendingUploads };
}
