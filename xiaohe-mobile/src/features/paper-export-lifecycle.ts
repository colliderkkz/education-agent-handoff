type Cleanup = () => void | Promise<void>;

/** Cleanup must never replace the original export error or turn a saved PDF into failure. */
export async function bestEffortExportCleanup(cleanup: Cleanup): Promise<void> {
  try { await cleanup(); } catch { /* Keep the original outcome; a later retry remains possible. */ }
}

export class PaperRenderTimeoutError extends Error {
  readonly code = 'PAPER_RENDER_TIMEOUT';
  constructor() {
    super('生成 PDF 等待超时。请重试；若再次无响应，请关闭并重新打开 App。原卷与已保存的文件不受影响。');
    this.name = 'PaperRenderTimeoutError';
  }
}

/** A crashed native renderer can leave its promise pending forever. It cannot be cancelled,
 * so a late success is discarded and only that result's own cache file may be removed. */
export function waitForPaperRender<Result>(pending: Promise<Result>, cleanupLateResult: (result: Result) => void | Promise<void>, timeoutMs = 30_000): Promise<Result> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new PaperRenderTimeoutError());
    }, timeoutMs);
    pending.then(result => {
      if (settled) {
        void bestEffortExportCleanup(() => cleanupLateResult(result));
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }, error => {
      // This handler also consumes a rejection after timeout, avoiding an unhandled promise.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

interface ExportLifecycle<Prepared, Result> {
  /** Must create a fresh directory and reject rather than reuse an existing one. */
  create: () => void | Promise<void>;
  prepare: () => Promise<Prepared>;
  /** The manifest write starts here. Any rejection can have an unknown commit outcome. */
  publish: (prepared: Prepared) => Promise<Result>;
  /** Must be scoped only to the directory allocated by this call's create. */
  cleanupUnpublished: Cleanup;
}

export async function runPaperExportLifecycle<Prepared, Result>(operations: ExportLifecycle<Prepared, Result>): Promise<Result> {
  let created = false;
  let publicationStarted = false;
  try {
    await operations.create();
    created = true;
    const prepared = await operations.prepare();
    publicationStarted = true;
    return await operations.publish(prepared);
  } catch (error) {
    if (created && !publicationStarted) await bestEffortExportCleanup(operations.cleanupUnpublished);
    throw error;
  }
}
