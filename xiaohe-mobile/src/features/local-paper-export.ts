import { randomUUID } from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { PaperPrintDocument } from './paper-print-template';
import { bestEffortExportCleanup, runPaperExportLifecycle, waitForPaperRender } from './paper-export-lifecycle';

const DIRECTORY = 'xiaohe-papers';
const UUID = /^[a-f0-9-]{36}$/i;
const fileNameValid = (name: unknown): name is string => typeof name === 'string' && name.length < 180 && !/[\u0000-\u001f/\\]/.test(name) && name.endsWith('.pdf');
export interface ExportedPaperFile { kind: 'student' | 'solutions'; name: string; }
export interface PaperExportBatch {
  schema: 1; id: string; paperId: string; paperVersion: number; title: string;
  createdAt: string; files: ExportedPaperFile[];
}

function batchDirectory(id: string) {
  if (!UUID.test(id)) throw new Error('本机文件记录无效，请重新生成。');
  return new Directory(Paths.document, DIRECTORY, id);
}
function checkedFile(batch: PaperExportBatch, file: ExportedPaperFile): File {
  if (!fileNameValid(file.name)) throw new Error('文件名称无效，请重新生成。');
  const stored = new File(batchDirectory(batch.id), file.name);
  if (!stored.exists || stored.size < 128) throw new Error('本机 PDF 已不存在或不完整，请重新生成；原试卷与作答记录仍保留。');
  return stored;
}
async function verifyPdf(file: File) {
  if (!file.exists || file.size < 128) throw new Error('PDF 未生成完整，请重试。');
  const handle = file.open(FileMode.ReadOnly);
  try {
    const bytes = await handle.readBytes(5);
    if (Array.from(bytes).join(',') !== '37,80,68,70,45') throw new Error('生成的文件不是完整 PDF，请重试。');
    handle.offset = Math.max(0, file.size - 1024);
    const tail = await handle.readBytes(Math.min(file.size, 1024));
    if (!/%%EOF\s*$/.test(String.fromCharCode(...tail))) throw new Error('PDF 尚未写入完整，请重试。');
  } finally { handle.close(); }
}

function deleteGeneratedCacheFile(uri: string): void {
  const file = new File(uri);
  const cachePrefix = `${Paths.cache.uri.replace(/\/+$/, '')}/`;
  if (file.uri.startsWith(cachePrefix) && file.exists) file.delete();
}

/** Publish a manifest only after every requested PDF exists and has a PDF header. */
export async function renderPaperPdfs(documents: PaperPrintDocument[]): Promise<PaperExportBatch> {
  if (documents.length < 1 || documents.length > 2) throw new Error('导出选择无效。');
  const first = documents[0];
  if (documents.some(d => d.paperId !== first.paperId || d.paperVersion !== first.paperVersion || !fileNameValid(d.fileName))) throw new Error('两份文件必须来自同一试卷版本。');
  const id = randomUUID();
  const directory = batchDirectory(id);
  return runPaperExportLifecycle({
    create: () => directory.create({ intermediates: true, idempotent: false }),
    prepare: async () => {
      const files: ExportedPaperFile[] = [];
      for (const document of documents) {
        const result = await waitForPaperRender(
          Print.printToFileAsync({ html: document.html, width: 595.28, height: 841.89, base64: false }),
          lateResult => deleteGeneratedCacheFile(lateResult.uri),
        );
        // Android can report 1 for a multi-page PDF. Treat this only as a positive
        // native-render signal; never store or display it as the actual page count.
        if (!Number.isInteger(result.numberOfPages) || result.numberOfPages < 1) throw new Error('没有生成可用的 PDF 页面，请重试。');
        const rendered = new File(result.uri);
        await verifyPdf(rendered);
        const destination = new File(directory, document.fileName);
        await rendered.copy(destination, { overwrite: false });
        if (destination.size !== rendered.size) throw new Error('PDF 未完整保存到本机，请重试。');
        await verifyPdf(destination);
        files.push({ kind: document.kind, name: document.fileName });
        // Only remove this print operation's cache output after its durable copy is verified.
        // A native result outside cache is never treated as disposable.
        await bestEffortExportCleanup(() => deleteGeneratedCacheFile(rendered.uri));
      }
      const manifest: PaperExportBatch = { schema: 1, id, paperId: first.paperId, paperVersion: first.paperVersion,
        title: first.title, createdAt: new Date().toISOString(), files };
      return { manifest, manifestFile: new File(directory, 'manifest.json'), json: JSON.stringify(manifest) };
    },
    publish: async ({ manifest, manifestFile, json }) => {
      await manifestFile.write(json);
      return manifest;
    },
    // The closure cannot reach any previous batch or the separate photo directory.
    // Once publish starts, preserve even an uncertain manifest for restart/reread recovery.
    cleanupUnpublished: () => { if (directory.exists) directory.delete(); },
  });
}

export async function listPaperPdfs(paperId: string, version: number): Promise<PaperExportBatch[]> {
  const directory = new Directory(Paths.document, DIRECTORY);
  if (!directory.exists) return [];
  const batches: PaperExportBatch[] = [];
  for (const child of directory.list()) {
    if (!(child instanceof Directory) || !UUID.test(child.name)) continue;
    const record = new File(child, 'manifest.json');
    if (!record.exists || record.size > 16_384) continue;
    try {
      const batch = JSON.parse(await record.text()) as PaperExportBatch;
      if (batch.schema !== 1 || batch.id !== child.name || batch.paperId !== paperId || batch.paperVersion !== version ||
        typeof batch.title !== 'string' || typeof batch.createdAt !== 'string' || !Number.isFinite(Date.parse(batch.createdAt)) ||
        !Array.isArray(batch.files) || batch.files.length < 1 || batch.files.length > 2 ||
        new Set(batch.files.map(file => file.kind)).size !== batch.files.length ||
        batch.files.some(file => !['student', 'solutions'].includes(file.kind) || !fileNameValid(file.name))) continue;
      for (const file of batch.files) await verifyPdf(checkedFile(batch, file));
      batches.push(batch);
    } catch { /* Preserve interrupted or unreadable private exports. They can be regenerated from the frozen paper. */ }
  }
  return batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function previewPaperPdf(batch: PaperExportBatch, file: ExportedPaperFile): Promise<'viewer' | 'print'> {
  const stored = checkedFile(batch, file);
  if (await stored.canPreview({ mimeType: 'application/pdf' })) {
    await stored.preview({ title: file.kind === 'student' ? '学生卷' : '答案解析卷', mimeType: 'application/pdf' });
    return 'viewer';
  }
  // The system print panel also previews PDF pages when no PDF viewer is installed.
  await Print.printAsync({ uri: stored.uri });
  return 'print';
}
export async function printPaperPdf(batch: PaperExportBatch, file: ExportedPaperFile): Promise<void> {
  await Print.printAsync({ uri: checkedFile(batch, file).uri });
}
export async function sharePaperPdf(batch: PaperExportBatch, file: ExportedPaperFile): Promise<void> {
  const stored = checkedFile(batch, file);
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前系统没有可用的分享入口；可以使用系统打印面板保存 PDF。');
  await Sharing.shareAsync(stored.uri, { dialogTitle: file.kind === 'student' ? '保存或分享学生卷' : '保存或分享答案解析卷', mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
