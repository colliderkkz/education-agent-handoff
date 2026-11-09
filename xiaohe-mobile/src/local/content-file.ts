import * as DocumentPicker from 'expo-document-picker';
import { File, FileMode } from 'expo-file-system';
import { readContentBytes } from './content-file-reader';

/** Reads only an explicitly selected, cached document. No cloud account or upload. */
export async function pickContentFile(): Promise<{ name: string; json: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'application/octet-stream'], multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const selected = result.assets[0];
  if (!selected || !selected.uri.startsWith('file://')) throw new Error('没有取得可读取的本机文件，请重新选择。');
  if (!selected.name.toLowerCase().endsWith('.json')) throw new Error('请选择教研端导出的 .json 内容包。');
  if (selected.size !== undefined && selected.size > 500 * 1024) throw new Error('内容包超过 500 KB，请分成较小的批次后再导入。');
  const file = new File(selected.uri);
  return { name: selected.name, json: await readContentBytes(file.open(FileMode.ReadOnly)) };
}
