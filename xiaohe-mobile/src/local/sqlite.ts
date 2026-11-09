import * as SQLite from 'expo-sqlite';
import type { LocalPersistence } from './types.ts';
import { createSQLitePersistence } from './sqlite-store.ts';

export async function openLocalPersistence(): Promise<LocalPersistence> {
  const db = await SQLite.openDatabaseAsync('xiaohe-learning-local-v1.db');
  return createSQLitePersistence(db);
}
