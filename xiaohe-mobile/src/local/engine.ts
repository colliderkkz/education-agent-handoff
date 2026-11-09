import { cloneData } from './clone.ts';
import { createSeedWorkspace } from './shared/seed.ts';
import { applyAction } from './shared/server/domain.ts';
import { ensureMastery } from './shared/server/mastery.ts';
import { ensureContent, previewContentPackage, applyContentPackage, rollbackContentBatch } from './shared/server/content.ts';
import { ensureCompanion } from './shared/server/companion.ts';
import { ensureEvidenceReviews } from './shared/server/evidence.ts';
import { ensureHistoryDeletion, completeHistoryFileTask } from './shared/server/history.ts';
import { historyDeletedUpload } from './shared/history-deletion.ts';
import { ensureRecognition } from './shared/server/recognition.ts';
import { upgradeLocalSamples } from './sample-upgrade.ts';
import { projectWorkspace } from './shared/server/access-policy.ts';
import { DomainError } from './shared/server/domain-error.ts';
import { LocalStorageError, type ApiResult, type LocalPersistence, type StoredLocalRecord, type WorkspaceState, type RecognitionRun } from './types.ts';
import { decodeWorkspace, encodeWorkspace } from './validation.ts';

export interface LearningSnapshot { state: WorkspaceState | null; loading: boolean; error: string | null; busy: boolean; }
export type NativeRecognitionResult = Pick<RecognitionRun, 'engine' | 'engineVersion' | 'imageDigest' | 'width' | 'height' | 'lines'>;
type Options = { persistence: LocalPersistence; newId: () => string; now?: () => string; removePhoto?: (uri: string) => Promise<void>; recognizePhoto?: (uri: string) => Promise<NativeRecognitionResult> };
const sameRecord = (a: StoredLocalRecord | null, b: StoredLocalRecord | null) => a?.revision === b?.revision && a?.payload === b?.payload;

/** One device, one local learner. This identity is never a cloud account. */
function freshWorkspace(newId: () => string, now: string): WorkspaceState {
  const state = createSeedWorkspace(`local-${newId()}`, '本机学习者', now);
  state.actor.role = 'student';
  state.profile.textbook = '四年级数学本机试验';
  state.questions = state.questions.filter(q => q.status === 'published');
  state.papers = []; state.attempts = []; state.evidence = []; state.mistakes = [];
  state.events = []; state.messages = []; state.helpRequests = []; state.uploads = [];
  delete state.access;
  ensureMastery(state, { now, newId, fresh: true });
  ensureContent(state);
  ensureCompanion(state, { now, newId, userId: state.actor.id });
  ensureEvidenceReviews(state);
  ensureHistoryDeletion(state);
  ensureRecognition(state);
  return state;
}

export class LocalLearningEngine {
  #raw: WorkspaceState | null = null;
  #record: StoredLocalRecord | null = null;
  #writable = false;
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #listeners = new Set<() => void>();
  #snapshot: LearningSnapshot = { state: null, loading: true, error: null, busy: false };
  #options: Options;
  constructor(options: Options) { this.#options = options; }
  getSnapshot = (): LearningSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  #now() { return this.#options.now?.() || new Date().toISOString(); }
  #publish(patch: Partial<LearningSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    // A consumer error must never turn a committed write into a failed action.
    for (const listener of this.#listeners) { try { listener(); } catch { /* isolated subscriber */ } }
  }
  #queue<T>(operation: () => Promise<T>): Promise<T> {
    this.#pending++; this.#publish({ busy: true });
    const run = this.#tail.then(async () => {
      try { const result = await operation(); this.#publish({ error: null }); return result; }
      catch (error) { this.#publish({ error: error instanceof Error ? error.message : '本机操作未完成，请重试。' }); throw error; }
      finally { this.#pending--; this.#publish({ busy: this.#pending > 0, loading: false }); }
    });
    this.#tail = run.catch(() => undefined);
    return run;
  }
  /** A retry never recreates an existing/corrupt record. Reads share the write queue. */
  reload = (): Promise<void> => this.#queue(async () => {
    this.#publish({ loading: true }); this.#writable = false;
    let stored: StoredLocalRecord | null;
    try { stored = await this.#options.persistence.load(); }
    catch { throw new LocalStorageError('暂时无法读取本机存储，原数据未修改。请重试读取。', 'unavailable'); }
    if (stored) {
      const raw = decodeWorkspace(stored);
      const missingMastery = !raw.mastery;
      const missingContent = !raw.content;
      const missingCompanion = !raw.companion;
      const missingEvidenceReviews = !raw.evidenceReviews;
      const missingHistoryDeletion = !raw.historyDeletion;
      const missingRecognition = !raw.recognition;
      const upgraded = upgradeLocalSamples(raw);
      if (missingMastery || missingContent || missingCompanion || missingEvidenceReviews || missingHistoryDeletion || missingRecognition || upgraded.updated || upgraded.added) {
        const now = this.#now();
        ensureMastery(raw, { now, newId: this.#options.newId });
        ensureContent(raw);
        ensureCompanion(raw, { now, newId: this.#options.newId, userId: raw.actor.id });
        ensureEvidenceReviews(raw);
        ensureHistoryDeletion(raw);
        ensureRecognition(raw);
        raw.events.unshift({ id: this.#options.newId(), action: 'local.migrate.mastery', label: '升级本机试用档案', actorId: raw.actor.id, createdAt: now,
          detail: `保留旧评定、原始作答、照片及冻结原卷；五星评定不补猜旧证据标签。题库更新 ${upgraded.updated} 道未编辑样例，新增 ${upgraded.added} 道迁移样例；${missingContent ? '已归档现有题目和原卷版本，不补造缺失历史；' : ''}${missingCompanion ? '已建立本机会话档案，旧消息题目版本未知，不猜测关联；' : ''}${missingEvidenceReviews ? '已建立空的证据核对档案，未补造更正或教师决定；' : ''}${missingHistoryDeletion ? '已建立空的历史删除档案，未删除任何学习记录或照片；' : ''}教学标注和参数尚未验证。` });
        if (missingRecognition) raw.events[0].detail += '已建立空的照片识别核对档案，未识别或上传旧照片。';
        raw.revision++;
        await this.#save(raw, stored);
        await this.#cleanHistoryFiles();
        return;
      }
      const projected = projectWorkspace(raw, 'student');
      this.#raw = raw; this.#record = stored; this.#writable = true;
      this.#publish({ state: projected });
      await this.#cleanHistoryFiles();
    } else {
      if (this.#record) throw new LocalStorageError('原有本机学习记录已丢失，已停止写入且未创建新记录。请先备份本机数据再处理。', 'corrupt');
      const raw = freshWorkspace(this.#options.newId, this.#now());
      await this.#save(raw, null);
    }
  });
  /** Snapshot payload immediately, so fast edits cannot mutate an already queued save. */
  act = (action: string, payload: Record<string, unknown> = {}): Promise<ApiResult> => {
    let input: Record<string, unknown>;
    try { input = cloneData(payload); }
    catch { return Promise.reject(new DomainError('操作数据无法保存，请检查输入。')); }
    return this.#queue(async () => {
      if (!this.#raw || !this.#writable) throw new LocalStorageError('本机数据尚未成功读取，请先重试读取后再操作。', 'unavailable');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('操作数据格式不正确。');
      const raw = this.#raw;
      if (action === 'history.files.retry') {
        await this.#cleanHistoryFiles();
        return { state: cloneData(this.#snapshot.state!), result: this.#fileCleanupResult() };
      }
      if (action.startsWith('recognition.') && !['recognition.match', 'recognition.entry.save', 'recognition.submit'].includes(action)) throw new DomainError('设备识别只能从本机照片入口运行。', 403);
      const outcome = action === 'local.recognition.scan' ? await this.#recognize(raw, input) : action.startsWith('local.content.') ? this.#content(raw, action, input) : action === 'local.upload' ? this.#upload(raw, input) : applyAction(raw, { ...input, action }, {
        userId: raw.actor.id, displayName: raw.profile.name, role: 'student', channel: 'local', now: this.#now(), newId: this.#options.newId,
      });
      if (action === 'help.create' && outcome.result) outcome.result.message = '求助摘要已记在本机，尚未发送给教师。';
      if (outcome.state.revision !== raw.revision) await this.#save(outcome.state, this.#record);
      if (action === 'history.delete.confirm') {
        await this.#cleanHistoryFiles();
        outcome.result = { ...outcome.result, ...this.#fileCleanupResult() };
      }
      // Never return the engine's full question bank to a view.
      return { state: cloneData(this.#snapshot.state!), result: cloneData(outcome.result) };
    });
  };
  /** Resolve the owned upload here, not from a screen-supplied URI. OCR and
   * deletion share this queue; the final CAS also rejects external disk changes.
   * Open + run are committed together, so an interrupted scan leaves no partial capture. */
  async #recognize(raw: WorkspaceState, input: Record<string, unknown>): Promise<ApiResult> {
    const { uploadId, requestId } = input;
    if (Object.keys(input).some(key => !['uploadId', 'requestId'].includes(key)) || typeof uploadId !== 'string' || typeof requestId !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(requestId)) throw new DomainError('识别请求不完整，请重新选择已保存照片。');
    const previous = raw.recognition?.requests.find(item => item.ownerId === raw.actor.id && item.requestId === `${requestId}:run`);
    if (previous) {
      const capture = raw.recognition!.captures.find(item => item.id === previous.captureId);
      if (capture?.uploadId !== uploadId) throw new DomainError('该识别请求已用于另一张照片。', 409);
      if (previous.status === 'deleted' || capture.redactedAt) throw new DomainError('该图的识别文字已删除，旧请求不能恢复。', 410);
      return { state: raw, result: { id: previous.resultId, captureId: capture.id, message: '已找回本次保存的识别文字，请逐项核对。' } };
    }
    const upload = raw.uploads.find(item => item.id === uploadId);
    if (!upload || historyDeletedUpload(raw, upload.id, upload.url)) throw new DomainError('该照片不存在或已经删除。', 410);
    if (raw.recognition?.captures.some(item => item.uploadId === uploadId && item.redactedAt)) throw new DomainError('该图的识别文字已随历史作答删除，不能重新识别。', 410);
    if (!this.#options.recognizePhoto) throw new DomainError('当前安装包不支持设备文字识别，请使用含识别模块的本机 App。', 503);
    const historyRevision = Math.max(0, ...(raw.historyDeletion?.operations || []).map(item => item.appliedRevision));
    const recognized = await this.#options.recognizePhoto(upload.url);
    const context = { userId: raw.actor.id, displayName: raw.profile.name, role: 'student' as const, channel: 'local' as const, now: this.#now(), newId: this.#options.newId };
    const opened = applyAction(raw, { action: 'recognition.open', uploadId, imageDigest: recognized.imageDigest, historyRevision, requestId: `${requestId}:open` }, context);
    const capture = opened.state.recognition!.captures.find(item => item.id === opened.result?.id);
    if (!capture) throw new DomainError('未取得照片识别档案，请重新读取后重试。');
    const saved = applyAction(opened.state, { action: 'recognition.run.save', captureId: capture.id, expectedRevision: capture.revision, historyRevision, runId: this.#options.newId(), ...recognized, platform: recognized.engine === 'mlkit-chinese' ? 'android' : 'ios', requestId: `${requestId}:run` }, context);
    saved.result = { ...saved.result, captureId: capture.id };
    return saved;
  }
  #fileCleanupResult() {
    const cleanupPending = this.#raw?.historyDeletion?.fileTasks.filter(task => task.status === 'pending').length ?? 0;
    return { cleanupPending, message: cleanupPending ? `学习记录已删除；${cleanupPending} 张本机照片仍待清理，可重试。` : '学习记录已删除，所选照片清理已完成。' };
  }
  /** Runs inside the engine queue and only against an acknowledged persisted
   * state. A failed delete or ack leaves the durable task for safe replay. */
  async #cleanHistoryFiles(): Promise<void> {
    if (!this.#options.removePhoto || !this.#raw || !this.#writable) return;
    const pending = this.#raw.historyDeletion?.fileTasks.filter(task => task.status === 'pending') ?? [];
    for (const task of pending) {
      try {
        await this.#options.removePhoto(task.uploadUrl);
        const result = completeHistoryFileTask(this.#raw, task.id, this.#now());
        if (result.state.revision !== this.#raw.revision) await this.#save(result.state, this.#record);
      } catch {
        // Never disguise a committed learning deletion as a rolled-back action.
        // The UI reads pending tasks even if the physical file is already gone.
        if (!this.#writable) break;
      }
    }
  }
  /** Local content management is deliberately separate from canonical student permissions. */
  #content(raw: WorkspaceState, action: string, input: Record<string, unknown>): ApiResult {
    const context = { userId: raw.actor.id, now: this.#now(), newId: this.#options.newId };
    if (action === 'local.content.preview') {
      if (typeof input.json !== 'string') throw new DomainError('请先选择 JSON 内容包。');
      return { state: raw, result: { preview: previewContentPackage(raw, input.json) } };
    }
    if (action === 'local.content.apply') {
      if (typeof input.json !== 'string' || typeof input.digest !== 'string' || !Number.isSafeInteger(input.sourceRevision)) throw new DomainError('请先预览这份内容包，再应用到本机。');
      return applyContentPackage(raw, input.json, { sourceRevision: input.sourceRevision as number, digest: input.digest }, context);
    }
    if (action === 'local.content.rollback') {
      if (typeof input.batchId !== 'string' || !Number.isSafeInteger(input.sourceRevision) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) throw new DomainError('请填写 1—500 字的回退原因。');
      return rollbackContentBatch(raw, input.batchId, input.sourceRevision as number, { ...context, reason: input.reason.trim() });
    }
    throw new DomainError('不支持这项本机内容操作。');
  }
  async #save(raw: WorkspaceState, previous: StoredLocalRecord | null): Promise<void> {
    const record = encodeWorkspace(raw);
    const projected = projectWorkspace(raw, 'student');
    try { await this.#options.persistence.commit(record, previous?.revision ?? null); }
    catch (cause) {
      let actual: StoredLocalRecord | null;
      try { actual = await this.#options.persistence.load(); }
      catch {
        this.#writable = false;
        const error = new LocalStorageError('本机保存结果暂时无法确认。请保留当前内容并重试读取，勿删除关联照片。', 'unavailable');
        error.commitState = 'unknown'; throw error;
      }
      if (!sameRecord(actual, record)) {
        const unchanged = sameRecord(actual, previous);
        if (!unchanged) this.#writable = false;
        const error = new LocalStorageError(unchanged ? '未能保存到本机，原记录保持不变，请重试。' : '本机记录已变化，为避免覆盖已停止保存。请重试读取后继续。', unchanged ? 'unavailable' : 'conflict');
        error.commitState = unchanged ? 'not-saved' : 'unknown';
        if (cause instanceof LocalStorageError && cause.code === 'conflict') this.#writable = false;
        throw error;
      }
      // Native code can commit before returning an error. Exact readback proves this write succeeded.
    }
    this.#raw = raw; this.#record = record; this.#writable = true;
    this.#publish({ state: projected });
  }
  #upload(raw: WorkspaceState, input: Record<string, unknown>): ApiResult {
    const { id, name, uri, purpose } = input;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(id) || typeof name !== 'string' || !name.trim() || name.length > 200 || typeof uri !== 'string' || !uri.startsWith('file:///') || uri.length > 3000 || !['single', 'homework'].includes(String(purpose))) throw new DomainError('请选择已保存到本机的照片。');
    if (historyDeletedUpload(raw, id, uri)) throw new DomainError('这张照片已经删除，旧页面不能重新登记。请重新读取本机记录。', 410);
    const existing = raw.uploads.find(u => u.id === id);
    if (existing) {
      if (existing.name !== name.trim() || existing.url !== uri || existing.purpose !== purpose) throw new DomainError('照片记录编号已用于其他文件，请重新选择照片。', 409);
      return { state: raw, result: { id, message: '照片已保存在本机。' } };
    }
    const state = cloneData(raw); const now = this.#now();
    state.uploads.unshift({ id, name: name.trim(), url: uri, purpose: purpose as 'single' | 'homework', status: 'pending', createdAt: now });
    state.events.unshift({ id: this.#options.newId(), action: 'local.upload', label: '保存本机照片', actorId: raw.actor.id, detail: id, createdAt: now });
    state.revision++;
    return { state, result: { id, message: '照片已保存在本机，未上传到云端。' } };
  }
}
