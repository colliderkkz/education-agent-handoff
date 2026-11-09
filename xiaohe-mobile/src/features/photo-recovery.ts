export interface PreparedPhoto { id: string; name: string; uri: string; }
export interface PhotoFileEntry { name: string; uri: string; size: number; }
export interface RegisteredPhoto { id: string; url: string; }

export const PHOTO_DIRECTORY = 'xiaohe-images';
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ownedName = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(?:jpe?g|png|webp|heic|heif|gif|avif)$/i;

/** Only complete-sized UUID image files immediately inside our private photo directory. */
export function findRecoverablePhotos(files: readonly PhotoFileEntry[], registered: readonly RegisteredPhoto[], directoryUri: string, deletedIds: readonly string[] = []): PreparedPhoto[] {
  const prefix = `${directoryUri.replace(/\/$/, '')}/`;
  const registeredIds = new Set(registered.map(photo => photo.id));
  const removedIds = new Set(deletedIds.map(id => id.toLowerCase()));
  const registeredUris = new Set(registered.map(photo => photo.url));
  const recoveredIds = new Set<string>();
  return files.flatMap(file => {
    const match = ownedName.exec(file.name);
    if (!match || file.uri !== `${prefix}${file.name}` || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) return [];
    const id = match[1];
    if (removedIds.has(id.toLowerCase()) || registeredIds.has(id) || registeredUris.has(file.uri) || recoveredIds.has(id)) return [];
    recoveredIds.add(id);
    return [{ id, name: `找回的拍题-${id.slice(0, 8)}`, uri: file.uri }];
  });
}

/** A reread can reveal that a previously uncertain save actually committed. */
export function photoRegistrationPayload(photo: PreparedPhoto, registered: readonly (RegisteredPhoto & { name: string })[], resolveUri: (uri: string) => string): PreparedPhoto {
  const existing = registered.find(item => item.id === photo.id);
  if (!existing) return photo;
  if (resolveUri(existing.url) !== resolveUri(photo.uri)) throw new Error('这张图片的保存记录不一致。请保留原图，重新读取本机记录后再试。');
  // Preserve the exact stored metadata for the engine's idempotency check, including
  // the original iOS container URI. Only the preview resolves it to the current path.
  return { id: existing.id, name: existing.name, uri: existing.url };
}
