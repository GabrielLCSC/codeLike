// ═══════════════════════════════════════════════════════════
//  WARFRONT — Custom maps in Firebase RTDB (/maps)
// ═══════════════════════════════════════════════════════════

import { auth } from '../auth.js';
import { validateMapData, MAP_SCHEMA_VERSION } from './map-schema.js';

async function ensureDb() {
  await auth.init();
  if (!auth.db) throw new Error('Firebase database not available.');
  if (!auth.uid) throw new Error('Sign in to save or load custom maps.');
  return auth.db;
}

/**
 * @param {import('./map-schema.js').CustomMapData} mapData
 */
export async function saveMapToFirebase(mapData) {
  const db = await ensureDb();
  validateMapData(mapData);
  const id = mapData.meta.id;
  const payload = {
    ...mapData,
    version: MAP_SCHEMA_VERSION,
    authorUid: auth.uid,
    authorName: auth.displayName ?? 'Editor',
    updatedAt: Date.now(),
  };
  await db.ref(`maps/${id}`).set(payload);
  return id;
}

/** @param {string} mapId */
export async function loadMapFromFirebase(mapId) {
  const db = await ensureDb();
  const snap = await db.ref(`maps/${mapId}`).once('value');
  if (!snap.exists()) throw new Error(`Map "${mapId}" not found.`);
  const data = snap.val();
  validateMapData(data);
  return data;
}

/** @returns {Promise<{ id: string, name: string, authorName?: string, updatedAt?: number }[]>} */
export async function listMapsFromFirebase() {
  await auth.init();
  if (!auth.db) return [];
  const snap = await auth.db.ref('maps').once('value');
  if (!snap.exists()) return [];
  const out = [];
  snap.forEach(child => {
    const v = child.val();
    out.push({
      id:          child.key,
      name:        v.meta?.name ?? child.key,
      authorName:  v.authorName,
      updatedAt:   v.updatedAt,
    });
  });
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** @param {string} mapId */
export async function deleteMapFromFirebase(mapId) {
  const db = await ensureDb();
  await db.ref(`maps/${mapId}`).remove();
}
