import * as Crypto from 'expo-crypto';
import { LocalLearningEngine } from './engine.ts';
import { openLocalPersistence } from './sqlite.ts';
import { localPhotoUri, removeOwnedLocalPhoto } from '../features/local-photo';
import { recognizePhoto } from '../features/native-ocr';

let enginePromise: Promise<LocalLearningEngine> | null = null;
/** Shared across screens and provider remounts; every write passes one queue. */
export function getLocalEngine(): Promise<LocalLearningEngine> {
  if (!enginePromise) {
    enginePromise = openLocalPersistence().then(persistence => new LocalLearningEngine({ persistence, newId: () => Crypto.randomUUID(), removePhoto: removeOwnedLocalPhoto, recognizePhoto: uri => recognizePhoto(localPhotoUri(uri)) })).catch(error => { enginePromise = null; throw error; });
  }
  return enginePromise;
}
