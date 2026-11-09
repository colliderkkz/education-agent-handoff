export type * from './shared/types';
export interface StoredLocalRecord { revision: number; payload: string; }
export interface LocalPersistence {
  load(): Promise<StoredLocalRecord | null>;
  /** A compare-and-swap write; null means create only when no row exists. */
  commit(record: StoredLocalRecord, expectedRevision: number | null): Promise<void>;
}
export class LocalStorageError extends Error {
  readonly code: 'corrupt' | 'conflict' | 'unavailable';
  commitState?: 'not-saved' | 'unknown';
  constructor(message: string, code: 'corrupt' | 'conflict' | 'unavailable') {
    super(message); this.name = 'LocalStorageError'; this.code = code;
  }
}
