import { LocalStorageError, type LocalPersistence, type StoredLocalRecord } from './types.ts';

/** Small injectable surface, implemented by Expo SQLite and exercised with real SQLite in tests. */
export interface AsyncLocalDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<{ changes: number }>;
}
export async function createSQLitePersistence(db: AsyncLocalDatabase): Promise<LocalPersistence> {
  await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS local_workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      payload TEXT NOT NULL
    );`);
  return {
    load: () => db.getFirstAsync<StoredLocalRecord>('SELECT revision, payload FROM local_workspace WHERE id = 1'),
    async commit(record, expectedRevision) {
      const result = expectedRevision === null
        ? await db.runAsync('INSERT INTO local_workspace (id, revision, payload) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING', record.revision, record.payload)
        : await db.runAsync('UPDATE local_workspace SET revision = ?, payload = ? WHERE id = 1 AND revision = ?', record.revision, record.payload, expectedRevision);
      if (result.changes !== 1) throw new LocalStorageError('本机记录已变化，请重试读取。', 'conflict');
    },
  };
}
