import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import { findRecoverablePhotos, MAX_IMAGE_BYTES, PHOTO_DIRECTORY, type PreparedPhoto, type RegisteredPhoto } from './photo-recovery';
import { ownedPhotoName } from './photo-cleanup';

export type { PreparedPhoto } from './photo-recovery';
const supportedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'avif']);

function imageExtension(asset: ImagePickerAsset): string {
  const mime = asset.mimeType?.split('/')[1]?.toLowerCase();
  if (mime && supportedExtensions.has(mime)) return mime;
  const extension = asset.uri.split('?')[0].split('.').pop()?.toLowerCase();
  return extension && supportedExtensions.has(extension) ? extension : 'jpg';
}

/** Copy the picker cache asset before registering it in the durable learning state. */
export async function prepareLocalPhoto(asset: ImagePickerAsset): Promise<PreparedPhoto> {
  if (!/^(file|content):\/\//.test(asset.uri)) throw new Error('没有取得可保存的本机图片，请重新选择。');
  if (asset.fileSize && asset.fileSize > MAX_IMAGE_BYTES) throw new Error('这张图片超过 15 MB，请先裁小一些，或重新拍摄一道题。');
  const directory = new Directory(Paths.document, PHOTO_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  const id = randomUUID();
  const destination = new File(directory, `${id}.${imageExtension(asset)}`);
  if (destination.exists) throw new Error('图片保存位置发生冲突，请重试。');
  try {
    await new File(asset.uri).copy(destination, { overwrite: false });
    if (!destination.exists || destination.size <= 0) throw new Error('图片没有完整保存，请重新选择。');
    if (destination.size > MAX_IMAGE_BYTES) throw new Error('这张图片超过 15 MB，请先裁小一些，或重新拍摄一道题。');
    const name = (asset.fileName || `拍题-${new Date().toLocaleDateString('zh-CN')}`).replace(/[\u0000-\u001f/\\]/g, '_').slice(0, 120);
    return { id, name, uri: destination.uri };
  } catch (error) {
    // This uniquely named file has not been passed to the state repository yet.
    // Never delete a picker original, a directory, or an already registered photo.
    try { if (destination.exists) destination.delete(); } catch { /* A private partial copy may remain; preserve the original error. */ }
    throw error;
  }
}

/** iOS can change an app container's root after restore; our owned basename is stable. */
export function localPhotoUri(uri: string): string {
  const ownedFile = uri.match(/\/xiaohe-images\/([a-f0-9-]{36}\.(?:jpe?g|png|webp|heic|heif|gif|avif))$/i);
  return ownedFile ? new File(Paths.document, PHOTO_DIRECTORY, ownedFile[1]).uri : uri;
}

/** Scan only this app's own photo folder; never read the photo library or other folders. */
export async function listRecoverableLocalPhotos(registered: readonly RegisteredPhoto[], deletedIds: readonly string[] = []): Promise<PreparedPhoto[]> {
  const directory = new Directory(Paths.document, PHOTO_DIRECTORY);
  if (!directory.exists) return [];
  const files = directory.list().filter((entry): entry is File => entry instanceof File)
    .map(file => ({ name: file.name, uri: file.uri, size: file.size }));
  return findRecoverablePhotos(files, registered.map(photo => ({ ...photo, url: localPhotoUri(photo.url) })), directory.uri, deletedIds);
}

/** Called only after the learning-state deletion and its durable cleanup task
 * have committed. Missing files count as success so interrupted work can retry. */
export async function removeOwnedLocalPhoto(uri: string): Promise<void> {
  const name = ownedPhotoName(uri);
  if (!name) throw new Error('该旧图片路径不属于应用管理的照片目录，无法自动清理。');
  const file = new File(Paths.document, PHOTO_DIRECTORY, name);
  if (file.exists) file.delete();
  if (file.exists) throw new Error('本机图片尚未清理完成，请重试。');
}
