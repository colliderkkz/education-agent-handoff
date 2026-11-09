/** Native picker recovery is one-shot. Keep its result until the user handles it. */
export function createPendingPhotoRecovery<T>() {
  let pending: Promise<T | null> | null = null;
  return {
    read(load: () => Promise<T | null>): Promise<T | null> {
      if (pending) return pending;
      const request = Promise.resolve().then(load).then(result => {
        if (result === null && pending === request) pending = null;
        return result;
      }, error => { if (pending === request) pending = null; throw error; });
      pending = request; return request;
    },
    retain(value: T) { pending = Promise.resolve(value); },
    clear() { pending = null; },
  };
}
