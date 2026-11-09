/** Stable identity of an image owned by this application. Container roots may
 * change on iOS restore; no external/library path is ever eligible for removal. */
export function ownedPhotoName(uri: string): string | null {
  if (!uri.startsWith('file:///') || /[?#]/.test(uri)) return null;
  const match = uri.match(/\/(?:files|Documents)\/xiaohe-images\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:jpe?g|png|webp|heic|heif|gif|avif))$/i);
  return match?.[1] ?? null;
}

export interface PhotoRemoval { uploadId: string; url: string; }

/** Both the registered ID and the private filename matter: legacy aliases may
 * register an owned image using a different upload ID. */
export function blockedPhotoIds(removals: readonly PhotoRemoval[]): string[] {
  return [...new Set(removals.flatMap(item => {
    const name = ownedPhotoName(item.url);
    return name ? [item.uploadId, name.slice(0, 36)] : [item.uploadId];
  }))];
}
