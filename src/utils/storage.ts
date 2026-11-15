import { BACKUP_META_KEY, STORAGE_KEY, type Chantier, type DB, type Journal } from '../types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeSignature(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'name' in val) {
    return String((val as { name?: unknown }).name ?? '');
  }
  return '';
}

function normalizeChantier(raw: Partial<Chantier>): Chantier {
  return {
    id: String(raw.id || uid()),
    numero: String(raw.numero || ''),
    projet: String(raw.projet || ''),
    entrepriseNom: String(raw.entrepriseNom || ''),
    entrepriseAdresse: String(raw.entrepriseAdresse || ''),
    references: String(raw.references || ''),
    adresseChantier: String(raw.adresseChantier || ''),
    horaireDebut: String(raw.horaireDebut || '07:30'),
    horaireFin: String(raw.horaireFin || '16:30'),
    preposeSurveillance: String(raw.preposeSurveillance || ''),
    postes: Array.isArray(raw.postes) ? raw.postes.map(String) : [],
  };
}

function normalizeJournal(raw: Partial<Journal>): Journal {
  const ouvriers = Array.isArray(raw.ouvriers)
    ? raw.ouvriers.map((o) => ({
        firme: String(o?.firme || ''),
        metier: String(o?.metier || ''),
        nbre: Number(o?.nbre) || 0,
      }))
    : [{ firme: '', metier: '', nbre: 1 }];

  return {
    id: String(raw.id || uid()),
    chantierId: String(raw.chantierId || ''),
    journalNum: Number(raw.journalNum) || 1,
    date: String(raw.date || ''),
    horaireDebut: String(raw.horaireDebut || ''),
    horaireFin: String(raw.horaireFin || ''),
    tempMatin: String(raw.tempMatin || ''),
    tempApresMidi: String(raw.tempApresMidi || ''),
    etatAtmo: Array.isArray(raw.etatAtmo) ? raw.etatAtmo.map(String) : [],
    ouvriers: ouvriers.length ? ouvriers : [{ firme: '', metier: '', nbre: 1 }],
    travaux: Array.isArray(raw.travaux) ? raw.travaux.map(String) : [],
    materiel: Array.isArray(raw.materiel) ? raw.materiel.map(String) : [],
    materiaux: Array.isArray(raw.materiaux) ? raw.materiaux.map(String) : [],
    essais: Array.isArray(raw.essais) ? raw.essais.map(String) : [],
    evenements: Array.isArray(raw.evenements) ? raw.evenements.map(String) : [],
    decisions: Array.isArray(raw.decisions) ? raw.decisions.map(String) : [],
    visites: Array.isArray(raw.visites) ? raw.visites.map(String) : [],
    sigEntrepreneur: normalizeSignature(raw.sigEntrepreneur),
  };
}

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chantiers: [], journaux: [] };
    const data = JSON.parse(raw) as Partial<DB>;
    const chantiers = Array.isArray(data.chantiers)
      ? data.chantiers.map(normalizeChantier)
      : [];
    const journaux = Array.isArray(data.journaux)
      ? data.journaux.map(normalizeJournal)
      : [];
    return { chantiers, journaux };
  } catch {
    return { chantiers: [], journaux: [] };
  }
}

export function saveDB(db: DB): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function getLastBackupDate(): string | null {
  try {
    return localStorage.getItem(BACKUP_META_KEY);
  } catch {
    return null;
  }
}

export function markBackupDone(): string {
  const now = new Date().toISOString();
  try {
    localStorage.setItem(BACKUP_META_KEY, now);
  } catch {
    // ignore quota errors
  }
  return now;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

// ---------- IndexedDB Handle Persistence for File System Access API ----------

export interface DirectoryHandleLike {
  name: string;
  queryPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  getFileHandle: (
    name: string,
    opts?: { create?: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

export function isFsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jt_fs_handles', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('handles')) {
        req.result.createObjectStore('handles');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(
  key: string,
  handle: DirectoryHandleLike
): Promise<void> {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDirHandle(
  key: string
): Promise<DirectoryHandleLike | null> {
  try {
    const db = await openHandleDB();
    return await new Promise((resolve) => {
      const tx = db.transaction('handles', 'readonly');
      const r = tx.objectStore('handles').get(key);
      r.onsuccess = () => resolve((r.result as DirectoryHandleLike) || null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteDirHandle(key: string): Promise<void> {
  try {
    const db = await openHandleDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function pickAndStoreFolder(
  key: string
): Promise<DirectoryHandleLike | null> {
  if (!isFsAccessSupported()) return null;
  const picker = (
    window as unknown as {
      showDirectoryPicker: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
    }
  ).showDirectoryPicker;
  const handle = await picker({ mode: 'readwrite' });
  await saveDirHandle(key, handle);
  return handle;
}

export async function ensureFolderPermission(
  handle: DirectoryHandleLike | null
): Promise<boolean> {
  if (!handle) return false;
  try {
    const opts = { mode: 'readwrite' as const };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  } catch {
    return false;
  }
}

export async function saveBlobToFolder(
  handle: DirectoryHandleLike,
  filename: string,
  blob: Blob
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export const DEFAULT_DAY_FOLDER_KEY = 'defaultDayFolder';
export const DEFAULT_WEEK_FOLDER_KEY = 'defaultWeekFolder';

export async function deliverFile(
  blob: Blob,
  filename: string,
  folderKey: string,
  fallbackFolderKey?: string
): Promise<{ mode: 'folder' | 'download'; folderName?: string }> {
  let handle = await getDirHandle(folderKey);
  if (!handle && fallbackFolderKey) {
    handle = await getDirHandle(fallbackFolderKey);
  }
  if (handle && (await ensureFolderPermission(handle))) {
    try {
      await saveBlobToFolder(handle, filename, blob);
      return { mode: 'folder', folderName: handle.name };
    } catch {
      downloadBlob(blob, filename);
      return { mode: 'download' };
    }
  }
  downloadBlob(blob, filename);
  return { mode: 'download' };
}
