import { updateProfile as updateAuthProfile, type User } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  isAdminEmail,
  isOfflineError,
  isQuotaExceededError,
  OperationType,
} from '../firebase';
import type {
  AccessStatus,
  AccessUserRecord,
  Chantier,
  ChantierShare,
  DB,
  Journal,
  JournalStatus,
  PageSignatureRecord,
  PreauthorizedEmail,
  ShareInvite,
  UserProfile,
} from '../types';
import { uid } from './storage';

// ---------------------------------------------------------------------------
// Normalization & Device Detection Helpers
// ---------------------------------------------------------------------------

export function sanitizeDocId(raw?: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 120);
  return cleaned || uid();
}

export function normalizeEmailId(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '_');
}

export function detectDeviceHint(): string {
  if (typeof navigator === 'undefined') return 'Appareil web';
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) {
    return /Mobile/i.test(ua) ? 'Smartphone Android' : 'Tablette Android';
  }
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Linux/i.test(ua)) return 'PC Linux';
  return 'Navigateur web';
}

function clampStr(val: unknown, max: number): string {
  return String(val ?? '').slice(0, max);
}

function clampStrList(
  val: unknown,
  maxItems: number,
  maxItemLen = 500
): string[] {
  if (!Array.isArray(val)) return [];
  return val.slice(0, maxItems).map((item) => clampStr(item, maxItemLen));
}

export function clampEmailList(val: unknown, maxItems = 3): string[] {
  if (!Array.isArray(val)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of val) {
    const clean = String(item ?? '').trim().toLowerCase().slice(0, 200);
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function generateDossierPinCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  const num = 100000 + (bytes[0] % 900000);
  return String(num);
}

export function normalizeDossierPinCode(val: unknown): string {
  const digits = String(val ?? '').replace(/\D/g, '');
  return digits.length === 6 ? digits : '';
}

export function extractChantierIdFromInput(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('chantier=')) {
    try {
      const url = new URL(
        trimmed.startsWith('http') ? trimmed : `https://local.app/?${trimmed.replace(/^\?/, '')}`
      );
      const param = url.searchParams.get('chantier');
      if (param) return sanitizeDocId(param.trim());
    } catch {
      const m = /[?&]chantier=([a-zA-Z0-9_-]+)/.exec(trimmed);
      if (m?.[1]) return sanitizeDocId(m[1]);
    }
  }
  return sanitizeDocId(trimmed);
}

// ---------------------------------------------------------------------------
// Offline Cache Helpers (localStorage — 0 Firestore reads on cached reload)
// ---------------------------------------------------------------------------

const ACCESS_CACHE_PREFIX = 'jt_access_approved_v1_';
const READER_CACHE_PREFIX = 'jt_reader_approved_v1_';
const CHANTIERS_CACHE_PREFIX = 'jt_chantiers_cache_v1_';
const JOURNALS_CACHE_PREFIX = 'jt_journals_cache_v1_';

export function getCachedReaderAccess(uidKey: string): boolean {
  try {
    return localStorage.getItem(`${READER_CACHE_PREFIX}${uidKey}`) === '1';
  } catch {
    return false;
  }
}

export function setCachedReaderAccess(uidKey: string, allowed: boolean): void {
  try {
    const key = `${READER_CACHE_PREFIX}${uidKey}`;
    if (allowed) {
      localStorage.setItem(key, '1');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
}

export function getCachedDeviceApproval(uidKey: string): AccessUserRecord | null {
  try {
    const raw = localStorage.getItem(`${ACCESS_CACHE_PREFIX}${uidKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccessUserRecord;
    return parsed?.status === 'approved' ? parsed : null;
  } catch {
    return null;
  }
}

export function setCachedDeviceApproval(
  uidKey: string,
  record: AccessUserRecord | null
): void {
  try {
    const key = `${ACCESS_CACHE_PREFIX}${uidKey}`;
    if (!record || record.status !== 'approved') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(record));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function getCachedChantiersBundle(userId: string): {
  chantiers: Chantier[];
  shareByChantierId: Record<string, ChantierShare>;
} | null {
  try {
    const raw = localStorage.getItem(`${CHANTIERS_CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      chantiers?: Chantier[];
      shareByChantierId?: Record<string, ChantierShare>;
    };
    if (!Array.isArray(parsed.chantiers)) return null;
    return {
      chantiers: parsed.chantiers,
      shareByChantierId: parsed.shareByChantierId || {},
    };
  } catch {
    return null;
  }
}

export function setCachedChantiersBundle(
  userId: string,
  payload: {
    chantiers: Chantier[];
    shareByChantierId: Record<string, ChantierShare>;
  }
): void {
  try {
    localStorage.setItem(
      `${CHANTIERS_CACHE_PREFIX}${userId}`,
      JSON.stringify(payload)
    );
  } catch {
    // ignore
  }
}

export function getCachedJournals(chantierId: string): Journal[] | null {
  try {
    const raw = localStorage.getItem(`${JOURNALS_CACHE_PREFIX}${chantierId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Journal[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setCachedJournals(chantierId: string, journals: Journal[]): void {
  try {
    localStorage.setItem(
      `${JOURNALS_CACHE_PREFIX}${chantierId}`,
      JSON.stringify(journals)
    );
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Colleague Access Control (1 getDocFromServer read at startup for non-admin)
// ---------------------------------------------------------------------------

export type StartupAccessResult =
  | { state: 'approved'; record: AccessUserRecord; offline?: boolean }
  | { state: 'pending'; record: AccessUserRecord }
  | { state: 'revoked'; record: AccessUserRecord }
  | { state: 'needs_code'; record: null }
  | { state: 'offline_unapproved'; record: null }
  | { state: 'quota_exceeded'; record: null; errorMessage: string };

function mapAccessUserDoc(
  data: Record<string, unknown>,
  fallbackUid: string
): AccessUserRecord {
  const statusRaw = String(data.status || 'pending');
  const status: AccessStatus =
    statusRaw === 'approved' || statusRaw === 'revoked' ? statusRaw : 'pending';
  return {
    uid: String(data.uid || fallbackUid),
    email: String(data.email || ''),
    displayName: String(data.displayName || 'Utilisateur'),
    role: data.role === 'admin' ? 'admin' : 'user',
    status,
    deviceHint: String(data.deviceHint || ''),
    note: String(data.note || ''),
    activationCode: String(data.activationCode || ''),
    createdAtMs: (data.createdAt as { toMillis?: () => number })?.toMillis?.(),
    updatedAtMs: (data.updatedAt as { toMillis?: () => number })?.toMillis?.(),
  };
}

export async function checkUserAccessStartup(
  user: User
): Promise<StartupAccessResult> {
  const accessRef = doc(db, 'access_users', user.uid);
  const currentDevice = detectDeviceHint();
  const currentName =
    user.displayName?.trim() || user.email?.split('@')[0] || 'Utilisateur';
  const currentEmail = (user.email || '').trim().toLowerCase();

  try {
    const snap = await getDocFromServer(accessRef);
    if (!snap.exists()) {
      setCachedDeviceApproval(user.uid, null);
      return { state: 'needs_code', record: null };
    }

    const record = mapAccessUserDoc(snap.data(), user.uid);

    if (record.status === 'revoked') {
      setCachedDeviceApproval(user.uid, null);
      return { state: 'revoked', record };
    }

    if (record.status === 'pending') {
      setCachedDeviceApproval(user.uid, null);
      return { state: 'pending', record };
    }

    // Approved! Save offline approval in localStorage.
    // Only write to Firestore if displayName / deviceHint / email actually changed!
    const changedFields: Record<string, unknown> = {};
    if (currentName && record.displayName !== currentName) {
      changedFields.displayName = clampStr(currentName, 120);
    }
    if (currentDevice && record.deviceHint !== currentDevice) {
      changedFields.deviceHint = clampStr(currentDevice, 120);
    }
    if (currentEmail && record.email.toLowerCase() !== currentEmail) {
      changedFields.email = clampStr(currentEmail, 200);
    }

    let finalRecord = record;
    if (Object.keys(changedFields).length > 0) {
      try {
        await updateDoc(accessRef, {
          ...changedFields,
          updatedAt: serverTimestamp(),
        });
        finalRecord = {
          ...record,
          displayName: String(changedFields.displayName || record.displayName),
          deviceHint: String(changedFields.deviceHint || record.deviceHint),
          email: String(changedFields.email || record.email),
        };
      } catch {
        // Non-fatal if metadata sync fails
      }
    }

    setCachedDeviceApproval(user.uid, finalRecord);
    return { state: 'approved', record: finalRecord };
  } catch (err) {
    if (isQuotaExceededError(err)) {
      const cached = getCachedDeviceApproval(user.uid);
      if (cached) {
        return { state: 'approved', record: cached, offline: true };
      }
      return {
        state: 'quota_exceeded',
        record: null,
        errorMessage:
          'Quota gratuit quotidien Firestore dépassé. Il se réinitialisera automatiquement demain.',
      };
    }

    if (isOfflineError(err) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      const cached = getCachedDeviceApproval(user.uid);
      if (cached) {
        return { state: 'approved', record: cached, offline: true };
      }
      return { state: 'offline_unapproved', record: null };
    }

    // Fallback offline check for unexpected transient error when device was already approved
    const cached = getCachedDeviceApproval(user.uid);
    if (cached && typeof navigator !== 'undefined' && !navigator.onLine) {
      return { state: 'approved', record: cached, offline: true };
    }
    throw err;
  }
}

export async function checkDossierReaderStartup(
  user: User,
  targetChantierId?: string | null
): Promise<boolean> {
  const emailLower = (user.email || '').trim().toLowerCase();
  if (!emailLower && !targetChantierId) return false;

  try {
    const checks: Array<Promise<boolean>> = [
      ...(emailLower
        ? [
            getDocsFromServer(
              query(
                collection(db, 'chantiers'),
                where('readerEmails', 'array-contains', emailLower)
              )
            )
              .then((snap) => !snap.empty)
              .catch(() => false),
          ]
        : []),
      getDocsFromServer(
        query(
          collection(db, 'chantierShares'),
          where('readerUid', '==', user.uid)
        )
      )
        .then((snap) => {
          const now = Date.now();
          return snap.docs.some((d) => {
            const raw = d.data();
            const exp = raw.expiresAt?.toMillis?.() ?? 0;
            return raw.revoked === false && exp > now;
          });
        })
        .catch(() => false),
    ];

    if (targetChantierId) {
      const cleanId = sanitizeDocId(targetChantierId);
      checks.push(
        getDocFromServer(doc(db, 'chantierShares', `${cleanId}_${user.uid}`))
          .then((snap) => {
            if (!snap.exists()) return false;
            const raw = snap.data();
            const exp = raw.expiresAt?.toMillis?.() ?? 0;
            return raw.revoked === false && exp > Date.now();
          })
          .catch(() => false),
        getDocFromServer(doc(db, 'chantiers', cleanId))
          .then((snap) => {
            if (!snap.exists()) return false;
            const data = snap.data();
            const emails = clampEmailList(data.readerEmails, 3);
            const readerIds = Array.isArray(data.readerIds)
              ? data.readerIds.map(String)
              : [];
            return (
              (Boolean(emailLower) && emails.includes(emailLower)) ||
              readerIds.includes(user.uid)
            );
          })
          .catch(() => false)
      );
    }

    const results = await Promise.all(checks);
    const hasAccess = results.some(Boolean);
    setCachedReaderAccess(user.uid, hasAccess);
    return hasAccess;
  } catch {
    return getCachedReaderAccess(user.uid);
  }
}

export async function activateWithPersonalCode(
  user: User,
  rawCode: string
): Promise<AccessUserRecord> {
  const code = rawCode.trim();
  if (code.length < 3 || code.length > 32) {
    throw new Error(
      'Le code personnel doit contenir entre 3 et 32 caractères.'
    );
  }
  const email = (user.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Adresse e-mail introuvable sur ce compte.');
  }

  const emailId = normalizeEmailId(email);
  const preauthRef = doc(db, 'preauthorized_emails', emailId);

  let preauthNote = '';
  try {
    const preSnap = await getDocFromServer(preauthRef);
    if (!preSnap.exists()) {
      throw new Error(
        `Aucun code personnel n'est configuré pour ${email}. Demandez l'accès ci-dessous ou contactez l'administrateur.`
      );
    }
    const preData = preSnap.data();
    const expectedCode = String(preData.accessCode || '').trim();
    if (expectedCode.toLowerCase() !== code.toLowerCase()) {
      throw new Error('Code personnel incorrect pour cette adresse e-mail.');
    }
    preauthNote = String(preData.note || '');
  } catch (err) {
    if (err instanceof Error && !err.message.includes('Firestore Error')) {
      if (isQuotaExceededError(err)) {
        throw new Error(
          'Quota gratuit quotidien Firestore dépassé. Le quota se réinitialisera demain.'
        );
      }
      if (isOfflineError(err)) {
        throw new Error(
          'Connexion Internet requise pour valider votre code personnel.'
        );
      }
      throw err;
    }
    throw err;
  }

  const displayName = clampStr(
    user.displayName?.trim() || email.split('@')[0] || 'Utilisateur',
    120
  );
  const deviceHint = clampStr(detectDeviceHint(), 120);
  const accessRef = doc(db, 'access_users', user.uid);

  try {
    const existingSnap = await getDocFromServer(accessRef);
    if (!existingSnap.exists()) {
      await setDoc(accessRef, {
        uid: user.uid,
        email: clampStr(email, 200),
        displayName,
        role: 'user',
        status: 'approved',
        deviceHint,
        note: clampStr(preauthNote, 250),
        activationCode: clampStr(code, 32),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = existingSnap.data();
      if (existingData.status === 'revoked') {
        throw new Error("Votre accès sur cet appareil a été révoqué par l'administrateur.");
      }
      await updateDoc(accessRef, {
        status: 'approved',
        activationCode: clampStr(code, 32),
        displayName,
        deviceHint,
        note: clampStr(preauthNote, 250),
        email: clampStr(email, 200),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("révoqué par l'administrateur")
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `access_users/${user.uid}`);
  }

  const approvedRecord: AccessUserRecord = {
    uid: user.uid,
    email,
    displayName,
    role: 'user',
    status: 'approved',
    deviceHint,
    note: preauthNote,
    activationCode: code,
  };
  setCachedDeviceApproval(user.uid, approvedRecord);
  return approvedRecord;
}

export async function requestAccessWithoutCode(
  user: User
): Promise<AccessUserRecord> {
  const email = clampStr((user.email || '').trim().toLowerCase(), 200);
  const displayName = clampStr(
    user.displayName?.trim() || email.split('@')[0] || 'Utilisateur',
    120
  );
  const deviceHint = clampStr(detectDeviceHint(), 120);
  const accessRef = doc(db, 'access_users', user.uid);

  try {
    const existingSnap = await getDocFromServer(accessRef);
    if (!existingSnap.exists()) {
      await setDoc(accessRef, {
        uid: user.uid,
        email,
        displayName,
        role: 'user',
        status: 'pending',
        deviceHint,
        note: '',
        activationCode: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `access_users/${user.uid}`);
  }

  return {
    uid: user.uid,
    email,
    displayName,
    role: 'user',
    status: 'pending',
    deviceHint,
    note: '',
    activationCode: '',
  };
}

// ---------------------------------------------------------------------------
// Admin-Only On-Demand Access Management (0 reads until "Accès" tab opened)
// ---------------------------------------------------------------------------

export async function fetchAdminAccessData(): Promise<{
  preauthorized: PreauthorizedEmail[];
  accessUsers: AccessUserRecord[];
}> {
  try {
    const [preSnap, usersSnap] = await Promise.all([
      getDocsFromServer(collection(db, 'preauthorized_emails')),
      getDocsFromServer(collection(db, 'access_users')),
    ]);

    const preauthorized: PreauthorizedEmail[] = preSnap.docs
      .map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id || d.id),
          email: String(raw.email || ''),
          accessCode: String(raw.accessCode || ''),
          note: String(raw.note || ''),
          createdBy: String(raw.createdBy || ''),
          createdAtMs: raw.createdAt?.toMillis?.(),
        };
      })
      .sort((a, b) => a.email.localeCompare(b.email));

    const accessUsers: AccessUserRecord[] = usersSnap.docs
      .map((d) => mapAccessUserDoc(d.data(), d.id))
      .sort((a, b) => a.email.localeCompare(b.email));

    return { preauthorized, accessUsers };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'preauthorized_emails');
  }
}

export async function savePreauthorizedEmailAdmin(params: {
  email: string;
  accessCode: string;
  note: string;
  adminEmail: string;
  existingAccessUsers: AccessUserRecord[];
}): Promise<PreauthorizedEmail> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanCode = params.accessCode.trim();
  const cleanNote = params.note.trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Adresse e-mail invalide.');
  }
  if (cleanCode.length < 3 || cleanCode.length > 32) {
    throw new Error(
      'Le code personnel doit comporter entre 3 et 32 caractères.'
    );
  }

  const emailId = normalizeEmailId(cleanEmail);
  const preRef = doc(db, 'preauthorized_emails', emailId);

  try {
    const existingPre = await getDocFromServer(preRef);
    if (!existingPre.exists()) {
      await setDoc(preRef, {
        id: emailId,
        email: clampStr(cleanEmail, 200),
        accessCode: clampStr(cleanCode, 32),
        note: clampStr(cleanNote, 250),
        createdBy: clampStr(params.adminEmail, 200),
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(preRef, {
        accessCode: clampStr(cleanCode, 32),
        note: clampStr(cleanNote, 250),
      });
    }

    // Automatically promote matching pending/revoked access_users records to approved
    const matchingDevices = params.existingAccessUsers.filter(
      (u) =>
        u.email.trim().toLowerCase() === cleanEmail &&
        (u.status === 'pending' || u.status === 'revoked')
    );
    for (const dev of matchingDevices) {
      await updateDoc(doc(db, 'access_users', dev.uid), {
        status: 'approved',
        activationCode: clampStr(cleanCode, 32),
        note: clampStr(cleanNote || dev.note, 250),
        updatedAt: serverTimestamp(),
      });
    }

    return {
      id: emailId,
      email: cleanEmail,
      accessCode: cleanCode,
      note: cleanNote,
      createdBy: params.adminEmail,
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `preauthorized_emails/${emailId}`
    );
  }
}

export async function deletePreauthorizedAndDevicesAdmin(
  emailId: string,
  email: string,
  existingAccessUsers: AccessUserRecord[]
): Promise<string[]> {
  const cleanEmail = email.trim().toLowerCase();
  const removedUids: string[] = [];
  try {
    await deleteDoc(doc(db, 'preauthorized_emails', emailId));
    const matching = existingAccessUsers.filter(
      (u) => u.email.trim().toLowerCase() === cleanEmail
    );
    for (const dev of matching) {
      await deleteDoc(doc(db, 'access_users', dev.uid));
      removedUids.push(dev.uid);
    }
    return removedUids;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `preauthorized_emails/${emailId}`
    );
  }
}

export async function updateAccessUserStatusAdmin(
  userId: string,
  status: AccessStatus
): Promise<void> {
  try {
    await updateDoc(doc(db, 'access_users', userId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `access_users/${userId}`);
  }
}

export async function deleteAccessUserAdmin(userId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'access_users', userId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `access_users/${userId}`);
  }
}

// ---------------------------------------------------------------------------
// User Preferences Profile (loaded on demand in Compte, or local default)
// ---------------------------------------------------------------------------

export function buildLocalDefaultProfile(user: User): UserProfile {
  const isSoleAdmin = isAdminEmail(user.email);
  return {
    uid: user.uid,
    displayName:
      user.displayName?.trim() ||
      (isSoleAdmin ? 'Fabien Pirquin' : user.email?.split('@')[0]) ||
      'Utilisateur INASEP',
    email: user.email || undefined,
    role: isSoleAdmin ? 'admin' : 'user',
    active: true,
    defaultPrepose: isSoleAdmin ? 'F. Pirquin' : '',
    defaultHoraireDebut: '07:30',
    defaultHoraireFin: '16:30',
  };
}

export async function fetchUserPreferencesOnce(user: User): Promise<UserProfile> {
  const fallback = buildLocalDefaultProfile(user);
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return fallback;
    const data = snap.data();
    return {
      ...fallback,
      displayName: String(data.displayName || fallback.displayName),
      defaultPrepose: String(data.defaultPrepose ?? fallback.defaultPrepose),
      defaultHoraireDebut: String(data.defaultHoraireDebut ?? '07:30'),
      defaultHoraireFin: String(data.defaultHoraireFin ?? '16:30'),
    };
  } catch {
    return fallback;
  }
}

export async function updateUserPreferences(
  userId: string,
  patch: {
    displayName: string;
    defaultPrepose: string;
    defaultHoraireDebut: string;
    defaultHoraireFin: string;
  }
): Promise<void> {
  const userRef = doc(db, 'users', userId);
  const currentUser = auth.currentUser;
  const isSoleAdmin = isAdminEmail(currentUser?.email);
  try {
    if (currentUser && currentUser.uid === userId) {
      await updateAuthProfile(currentUser, {
        displayName: clampStr(patch.displayName.trim(), 120),
      });
    }
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: userId,
        displayName: clampStr(patch.displayName.trim() || 'Utilisateur', 120),
        role: isSoleAdmin ? 'admin' : 'user',
        active: true,
        defaultPrepose: clampStr(patch.defaultPrepose.trim(), 150),
        defaultHoraireDebut: clampStr(patch.defaultHoraireDebut || '07:30', 20),
        defaultHoraireFin: clampStr(patch.defaultHoraireFin || '16:30', 20),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName: clampStr(patch.displayName.trim() || 'Utilisateur', 120),
        defaultPrepose: clampStr(patch.defaultPrepose.trim(), 150),
        defaultHoraireDebut: clampStr(patch.defaultHoraireDebut || '07:30', 20),
        defaultHoraireFin: clampStr(patch.defaultHoraireFin || '16:30', 20),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
  }
}

// ---------------------------------------------------------------------------
// Chantiers & Journaux (One-Shot Fetches + Local Offline Cache, NO onSnapshot)
// ---------------------------------------------------------------------------

function sanitizeChantierPayload(
  ch: Chantier,
  ownerId: string,
  ownerName: string,
  isCreate: boolean,
  existingCreatedAt?: unknown
) {
  const readerIds = clampStrList(ch.readerIds || [], 25, 128).filter((id) =>
    /^[a-zA-Z0-9_-]+$/.test(id)
  );
  const readerEmails = clampEmailList(ch.readerEmails || [], 3);
  const normalizedPin = normalizeDossierPinCode(ch.readerAccessCode);
  const readerAccessCode =
    normalizedPin || (readerEmails.length > 0 ? generateDossierPinCode() : '');

  return {
    id: sanitizeDocId(ch.id),
    ownerId,
    ownerName: clampStr(ownerName, 120),
    visibility: 'private' as const,
    readerIds,
    readerEmails,
    readerAccessCode,
    journalIds: clampStrList(
      (ch as Chantier & { journalIds?: string[] }).journalIds || [],
      1000,
      128
    ),
    numero: clampStr(ch.numero, 100),
    projet: clampStr(ch.projet, 250),
    entrepriseNom: clampStr(ch.entrepriseNom, 200),
    entrepriseAdresse: clampStr(ch.entrepriseAdresse, 500),
    references: clampStr(ch.references, 150),
    adresseChantier: clampStr(ch.adresseChantier, 500),
    horaireDebut: clampStr(ch.horaireDebut || '07:30', 20),
    horaireFin: clampStr(ch.horaireFin || '16:30', 20),
    preposeSurveillance: clampStr(ch.preposeSurveillance, 150),
    postes: clampStrList(ch.postes, 2000, 350),
    createdAt: isCreate
      ? serverTimestamp()
      : existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function sanitizeJournalPayload(
  j: Journal,
  chantier: Chantier,
  authorId: string,
  authorName: string,
  isCreate: boolean,
  existingCreatedAt?: unknown
) {
  const ouvriers = (Array.isArray(j.ouvriers) ? j.ouvriers : [])
    .slice(0, 100)
    .map((o) => ({
      firme: clampStr(o?.firme, 150),
      metier: clampStr(o?.metier, 150),
      nbre: Math.max(0, Math.min(9999, Number(o?.nbre) || 0)),
    }));

  const chantierReaderIds = clampStrList(
    chantier.readerIds || [],
    25,
    128
  ).filter((id) => /^[a-zA-Z0-9_-]+$/.test(id));
  const chantierReaderEmails = clampEmailList(chantier.readerEmails || [], 3);

  const status: JournalStatus =
    j.status === 'completed' ? 'completed' : 'in_progress';

  return {
    id: sanitizeDocId(j.id),
    chantierId: sanitizeDocId(chantier.id),
    chantierOwnerId: chantier.ownerId || authorId,
    chantierReaderIds,
    chantierReaderEmails,
    authorId,
    authorName: clampStr(authorName, 120),
    status,
    journalNum: Math.max(1, Math.min(99999, Number(j.journalNum) || 1)),
    date: clampStr(j.date, 20),
    horaireDebut: clampStr(j.horaireDebut, 20),
    horaireFin: clampStr(j.horaireFin, 20),
    tempMatin: clampStr(j.tempMatin, 20),
    tempApresMidi: clampStr(j.tempApresMidi, 20),
    etatAtmo: clampStrList(j.etatAtmo, 20, 160),
    ouvriers,
    travaux: clampStrList(j.travaux, 200, 600),
    materiel: clampStrList(j.materiel, 200, 400),
    materiaux: clampStrList(j.materiaux, 200, 400),
    essais: clampStrList(j.essais, 200, 400),
    evenements: clampStrList(j.evenements, 200, 500),
    decisions: clampStrList(j.decisions, 200, 500),
    visites: clampStrList(j.visites, 200, 400),
    sigEntrepreneur: clampStr(j.sigEntrepreneur, 150),
    signatureControleur: j.signatureControleur ?? null,
    signatureLecteur: j.signatureLecteur ?? null,
    createdAt: isCreate
      ? serverTimestamp()
      : existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function fetchChantiersAndSharesOnce(
  userId: string,
  userEmail?: string | null
): Promise<{
  chantiers: Chantier[];
  shareByChantierId: Record<string, ChantierShare>;
  fromCache?: boolean;
}> {
  const emailLower = (userEmail || '').trim().toLowerCase();

  try {
    const [ownedSnap, sharesSnap, emailSnap] = await Promise.all([
      getDocsFromServer(
        query(collection(db, 'chantiers'), where('ownerId', '==', userId))
      ),
      getDocsFromServer(
        query(
          collection(db, 'chantierShares'),
          where('readerUid', '==', userId)
        )
      ).catch(() => null),
      emailLower
        ? getDocsFromServer(
            query(
              collection(db, 'chantiers'),
              where('readerEmails', 'array-contains', emailLower)
            )
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    const merged = new Map<string, Chantier>();
    ownedSnap.docs.forEach((d) => merged.set(d.id, d.data() as Chantier));
    if (emailSnap) {
      emailSnap.docs.forEach((d) => merged.set(d.id, d.data() as Chantier));
    }

    const now = Date.now();
    const shareByChantierId: Record<string, ChantierShare> = {};
    const activeSharedIds: string[] = [];

    if (sharesSnap) {
      sharesSnap.docs.forEach((d) => {
        const raw = d.data();
        const expiresAtMs = raw.expiresAt?.toMillis?.() ?? 0;
        if (raw.revoked === false && expiresAtMs > now) {
          const share: ChantierShare = {
            id: String(raw.id || d.id),
            chantierId: String(raw.chantierId),
            chantierOwnerId: String(raw.chantierOwnerId),
            inviteCode: String(raw.inviteCode),
            readerUid: String(raw.readerUid),
            readerName: String(raw.readerName || ''),
            label: String(raw.label || ''),
            revoked: false,
            expiresAtMs,
          };
          shareByChantierId[share.chantierId] = share;
          if (!merged.has(share.chantierId)) {
            activeSharedIds.push(share.chantierId);
          }
        }
      });
    }

    if (activeSharedIds.length > 0) {
      await Promise.all(
        activeSharedIds.map(async (cId) => {
          try {
            const chSnap = await getDocFromServer(doc(db, 'chantiers', cId));
            if (chSnap.exists()) {
              merged.set(cId, chSnap.data() as Chantier);
            }
          } catch {
            // ignore expired or inaccessible individual shares
          }
        })
      );
    }

    const chantiers = Array.from(merged.values()).sort((a, b) =>
      (a.numero || a.projet || '').localeCompare(b.numero || b.projet || '')
    );

    const bundle = { chantiers, shareByChantierId };
    setCachedChantiersBundle(userId, bundle);
    return bundle;
  } catch (error) {
    if (isOfflineError(error) || isQuotaExceededError(error)) {
      const cached = getCachedChantiersBundle(userId);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }
    handleFirestoreError(error, OperationType.LIST, 'chantiers');
  }
}

export async function fetchChantierJournauxOnce(
  chantier: Chantier,
  userId: string,
  userEmail?: string | null
): Promise<Journal[]> {
  const col = collection(db, 'chantiers', chantier.id, 'journaux');
  const emailLower = (userEmail || '').trim().toLowerCase();
  const isEmailReader =
    Boolean(emailLower) &&
    clampEmailList(chantier.readerEmails || [], 3).includes(emailLower);

  try {
    const docMap = new Map<string, Record<string, unknown>>();

    if (chantier.ownerId === userId) {
      const snap = await getDocsFromServer(
        query(col, where('chantierOwnerId', '==', userId))
      );
      snap.docs.forEach((d) => docMap.set(d.id, d.data()));
    } else {
      const queries: Array<Promise<void>> = [];
      if (isEmailReader) {
        queries.push(
          getDocsFromServer(
            query(col, where('chantierReaderEmails', 'array-contains', emailLower))
          ).then((snap) => {
            snap.docs.forEach((d) => docMap.set(d.id, d.data()));
          })
        );
      }
      if (!isEmailReader || (chantier.readerIds || []).includes(userId)) {
        queries.push(
          getDocsFromServer(
            query(col, where('chantierReaderIds', 'array-contains', userId))
          )
            .then((snap) => {
              snap.docs.forEach((d) => docMap.set(d.id, d.data()));
            })
            .catch((err) => {
              if (!isEmailReader) throw err;
            })
        );
      }
      await Promise.all(queries);
    }

    const list = Array.from(docMap.values())
      .map((rawData) => {
        const raw = rawData as unknown as Journal;
        return {
          ...raw,
          status:
            raw.status === 'completed'
              ? ('completed' as const)
              : ('in_progress' as const),
          signatureControleur: raw.signatureControleur ?? null,
          signatureLecteur: raw.signatureLecteur ?? null,
        };
      })
      .sort(
        (a, b) =>
          (a.date || '').localeCompare(b.date || '') ||
          a.journalNum - b.journalNum
      );
    setCachedJournals(chantier.id, list);
    return list;
  } catch (error) {
    if (isOfflineError(error) || isQuotaExceededError(error)) {
      const cached = getCachedJournals(chantier.id);
      if (cached) return cached;
    }
    handleFirestoreError(
      error,
      OperationType.LIST,
      `chantiers/${chantier.id}/journaux`
    );
  }
}

async function syncDossierAccessGrant(
  chantier: Chantier,
  user: User,
  ownerName: string,
  readerAccessCode: string
): Promise<void> {
  const cId = sanitizeDocId(chantier.id);
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'dossier_access'), where('ownerId', '==', user.uid))
    );
    const chantierDocs = existingSnap.docs.filter(
      (d) => d.data().chantierId === cId
    );
    for (const d of chantierDocs) {
      if (d.data().code !== readerAccessCode && d.data().active === true) {
        await updateDoc(d.ref, {
          active: false,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }

    if (!readerAccessCode) return;

    const accessId = `${cId}_${readerAccessCode}`;
    const ref = doc(db, 'dossier_access', accessId);
    const expiresDate = new Date();
    expiresDate.setMonth(expiresDate.getMonth() + 36);
    const expiresTs = Timestamp.fromDate(expiresDate);

    const matchExisting = chantierDocs.find((d) => d.id === accessId);
    if (!matchExisting) {
      await setDoc(ref, {
        id: accessId,
        code: readerAccessCode,
        chantierId: cId,
        chantierNumero: clampStr(chantier.numero, 100),
        chantierProjet: clampStr(chantier.projet, 250),
        ownerId: user.uid,
        ownerName: clampStr(ownerName, 120),
        active: true,
        expiresAt: expiresTs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        active: true,
        expiresAt: expiresTs,
        chantierNumero: clampStr(chantier.numero, 100),
        chantierProjet: clampStr(chantier.projet, 250),
        ownerName: clampStr(ownerName, 120),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-fatal if offline or transient error
  }
}

export async function saveChantierCloud(
  chantier: Chantier,
  user: User
): Promise<Chantier> {
  const id = sanitizeDocId(chantier.id);
  const ref = doc(db, 'chantiers', id);
  const ownerName =
    chantier.ownerName ||
    user.displayName ||
    user.email?.split('@')[0] ||
    'Utilisateur';
  const readerEmails = clampEmailList(chantier.readerEmails || [], 3);
  const normalizedPin = normalizeDossierPinCode(chantier.readerAccessCode);
  const readerAccessCode =
    normalizedPin || (readerEmails.length > 0 ? generateDossierPinCode() : '');

  try {
    if (!chantier.ownerId) {
      const payload = sanitizeChantierPayload(
        { ...chantier, id, readerEmails, readerAccessCode },
        user.uid,
        ownerName,
        true
      );
      await setDoc(ref, payload);
      const savedNew: Chantier = {
        ...chantier,
        id,
        ownerId: user.uid,
        ownerName,
        visibility: 'private',
        readerIds: payload.readerIds,
        readerEmails,
        readerAccessCode,
      };
      if (readerAccessCode) {
        await syncDossierAccessGrant(savedNew, user, ownerName, readerAccessCode);
      }
      return savedNew;
    }

    const updateFields: Record<string, unknown> = {
      readerEmails,
      readerAccessCode,
      numero: clampStr(chantier.numero, 100),
      projet: clampStr(chantier.projet, 250),
      entrepriseNom: clampStr(chantier.entrepriseNom, 200),
      entrepriseAdresse: clampStr(chantier.entrepriseAdresse, 500),
      references: clampStr(chantier.references, 150),
      adresseChantier: clampStr(chantier.adresseChantier, 500),
      horaireDebut: clampStr(chantier.horaireDebut || '07:30', 20),
      horaireFin: clampStr(chantier.horaireFin || '16:30', 20),
      preposeSurveillance: clampStr(chantier.preposeSurveillance, 150),
      postes: clampStrList(chantier.postes, 2000, 350),
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(ref, updateFields);

      // Sync chantierReaderEmails across all existing journals of this chantier
      try {
        const jSnap = await getDocs(
          query(
            collection(db, 'chantiers', id, 'journaux'),
            where('chantierOwnerId', '==', user.uid)
          )
        );
        const docsToSync = jSnap.docs.filter((d) => {
          const existingEmails = clampEmailList(d.data().chantierReaderEmails, 3);
          return (
            existingEmails.length !== readerEmails.length ||
            existingEmails.some((e, idx) => e !== readerEmails[idx])
          );
        });
        for (let i = 0; i < docsToSync.length; i += 350) {
          const batch = writeBatch(db);
          docsToSync.slice(i, i + 350).forEach((d) => {
            batch.update(d.ref, {
              chantierReaderEmails: readerEmails,
              updatedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
      } catch {
        // Non-fatal if offline; new journals will read chantier.readerEmails
      }

      const savedExisting: Chantier = {
        ...chantier,
        id,
        ownerId: chantier.ownerId,
        ownerName,
        visibility: 'private',
        readerIds: chantier.readerIds || [],
        readerEmails,
        readerAccessCode,
      };
      await syncDossierAccessGrant(savedExisting, user, ownerName, readerAccessCode);
      return savedExisting;
    } catch (updateErr) {
      const code = (updateErr as { code?: string })?.code || '';
      if (code === 'not-found') {
        const payload = sanitizeChantierPayload(
          { ...chantier, id, readerEmails, readerAccessCode },
          user.uid,
          ownerName,
          true
        );
        await setDoc(ref, payload);
        const savedFallback: Chantier = {
          ...chantier,
          id,
          ownerId: user.uid,
          ownerName,
          visibility: 'private',
          readerIds: payload.readerIds,
          readerEmails,
          readerAccessCode,
        };
        if (readerAccessCode) {
          await syncDossierAccessGrant(
            savedFallback,
            user,
            ownerName,
            readerAccessCode
          );
        }
        return savedFallback;
      }
      throw updateErr;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chantiers/${id}`);
  }
}

export async function deleteChantierCloud(chantierId: string): Promise<void> {
  const id = sanitizeDocId(chantierId);
  try {
    const jSnap = await getDocs(collection(db, 'chantiers', id, 'journaux'));
    for (let i = 0; i < jSnap.docs.length; i += 400) {
      const batch = writeBatch(db);
      jSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'chantiers', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `chantiers/${id}`);
  }
}

const ALLOWED_JOURNAL_KEYS = new Set([
  'id',
  'chantierId',
  'chantierOwnerId',
  'chantierReaderIds',
  'chantierReaderEmails',
  'authorId',
  'authorName',
  'status',
  'journalNum',
  'date',
  'horaireDebut',
  'horaireFin',
  'tempMatin',
  'tempApresMidi',
  'etatAtmo',
  'ouvriers',
  'travaux',
  'materiel',
  'materiaux',
  'essais',
  'evenements',
  'decisions',
  'visites',
  'sigEntrepreneur',
  'signatureControleur',
  'signatureLecteur',
  'createdAt',
  'updatedAt',
]);

function isFirestoreTimestamp(val: unknown): boolean {
  return Boolean(
    val &&
      typeof val === 'object' &&
      typeof (val as { toMillis?: unknown }).toMillis === 'function'
  );
}

function isValidFirestoreIdValue(val: unknown): val is string {
  return typeof val === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(val);
}

function isBoundedStringArray(val: unknown, maxItems: number): boolean {
  return (
    Array.isArray(val) &&
    val.length <= maxItems &&
    (val.length === 0 || typeof val[0] === 'string')
  );
}

function hasValidSignatureShape(
  sig: unknown,
  expectedRole: 'controleur' | 'lecteur'
): boolean {
  if (sig == null) return true;
  if (typeof sig !== 'object') return false;
  const rec = sig as Record<string, unknown>;
  const methodStr = String(rec.method || '');
  return (
    rec.role === expectedRole &&
    (methodStr === 'itsme' || methodStr === 'eid') &&
    isValidFirestoreIdValue(rec.signerUid) &&
    typeof rec.signerName === 'string' &&
    rec.signerName.length >= 1 &&
    rec.signerName.length <= 120
  );
}

function serverJournalNeedsSchemaCleanup(
  raw: Record<string, unknown>,
  cId: string,
  jId: string
): boolean {
  if (Object.keys(raw).some((k) => !ALLOWED_JOURNAL_KEYS.has(k))) return true;
  if (raw.id !== jId || raw.chantierId !== cId) return true;
  if (!isValidFirestoreIdValue(raw.chantierOwnerId)) return true;
  if (!isValidFirestoreIdValue(raw.authorId)) return true;
  if (typeof raw.authorName !== 'string' || raw.authorName.length > 120) return true;
  if (raw.status !== 'in_progress' && raw.status !== 'completed') return true;
  if (
    typeof raw.journalNum !== 'number' ||
    !Number.isFinite(raw.journalNum) ||
    raw.journalNum < 1 ||
    raw.journalNum > 99999
  ) {
    return true;
  }
  if (typeof raw.date !== 'string' || raw.date.length > 20) return true;
  if (typeof raw.horaireDebut !== 'string' || raw.horaireDebut.length > 20) return true;
  if (typeof raw.horaireFin !== 'string' || raw.horaireFin.length > 20) return true;
  if (typeof raw.tempMatin !== 'string' || raw.tempMatin.length > 20) return true;
  if (typeof raw.tempApresMidi !== 'string' || raw.tempApresMidi.length > 20) return true;
  if (typeof raw.sigEntrepreneur !== 'string' || raw.sigEntrepreneur.length > 150) return true;
  if (!isBoundedStringArray(raw.etatAtmo, 20)) return true;
  if (
    !Array.isArray(raw.ouvriers) ||
    raw.ouvriers.length > 100 ||
    (raw.ouvriers.length > 0 &&
      (!raw.ouvriers[0] || typeof raw.ouvriers[0] !== 'object'))
  ) {
    return true;
  }
  if (
    !isBoundedStringArray(raw.travaux, 200) ||
    !isBoundedStringArray(raw.materiel, 200) ||
    !isBoundedStringArray(raw.materiaux, 200) ||
    !isBoundedStringArray(raw.essais, 200) ||
    !isBoundedStringArray(raw.evenements, 200) ||
    !isBoundedStringArray(raw.decisions, 200) ||
    !isBoundedStringArray(raw.visites, 200)
  ) {
    return true;
  }
  if (!isBoundedStringArray(raw.chantierReaderIds, 25)) return true;
  if (
    raw.chantierReaderEmails !== undefined &&
    !isBoundedStringArray(raw.chantierReaderEmails, 3)
  ) {
    return true;
  }
  if (!hasValidSignatureShape(raw.signatureControleur, 'controleur')) return true;
  if (!hasValidSignatureShape(raw.signatureLecteur, 'lecteur')) return true;
  if (!isFirestoreTimestamp(raw.createdAt)) return true;
  if (!isFirestoreTimestamp(raw.updatedAt)) return true;
  return false;
}

async function resolveLiveChantierReaders(
  chantier: Chantier,
  cId: string
): Promise<Chantier> {
  let liveChantier = { ...chantier, id: cId };
  try {
    const chSnap = await getDocFromServer(doc(db, 'chantiers', cId));
    if (chSnap.exists()) {
      const chData = chSnap.data();
      liveChantier = {
        ...liveChantier,
        ownerId:
          typeof chData.ownerId === 'string' && chData.ownerId
            ? chData.ownerId
            : liveChantier.ownerId,
        readerIds: Array.isArray(chData.readerIds)
          ? chData.readerIds.map(String)
          : liveChantier.readerIds,
        readerEmails: Array.isArray(chData.readerEmails)
          ? clampEmailList(chData.readerEmails, 3)
          : liveChantier.readerEmails,
      };
    }
  } catch {
    // Fallback to provided chantier readers if offline/transient
  }
  return liveChantier;
}

export async function saveJournalCloud(
  journal: Journal,
  chantier: Chantier,
  user: User
): Promise<void> {
  const cId = sanitizeDocId(chantier.id);
  const jId = sanitizeDocId(journal.id);
  const ref = doc(db, 'chantiers', cId, 'journaux', jId);

  try {
    const snap = await getDoc(ref);
    const authorName =
      user.displayName || user.email?.split('@')[0] || 'Utilisateur';

    if (!snap.exists()) {
      const liveChantier = await resolveLiveChantierReaders(chantier, cId);
      const payload = sanitizeJournalPayload(
        { ...journal, id: jId, chantierId: cId },
        liveChantier,
        user.uid,
        authorName,
        true
      );
      await setDoc(ref, payload);
      await updateDoc(doc(db, 'chantiers', cId), {
        journalIds: arrayUnion(jId),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const serverData = snap.data();
    const hasCtrlSig =
      serverData?.signatureControleur != null &&
      typeof serverData.signatureControleur === 'object';
    const hasReaderSig =
      serverData?.signatureLecteur != null &&
      typeof serverData.signatureLecteur === 'object';

    if (hasCtrlSig || hasReaderSig) {
      throw new Error(
        'Cette page a déjà été signée par un membre et ne peut plus être modifiée.'
      );
    }

    if (serverJournalNeedsSchemaCleanup(serverData, cId, jId)) {
      const liveChantier = await resolveLiveChantierReaders(chantier, cId);
      const validCreatedAt = isFirestoreTimestamp(serverData.createdAt)
        ? serverData.createdAt
        : undefined;
      const validAuthorId = isValidFirestoreIdValue(serverData.authorId)
        ? serverData.authorId
        : user.uid;
      const resolvedAuthorName =
        typeof serverData.authorName === 'string' && serverData.authorName.trim()
          ? serverData.authorName.slice(0, 120)
          : authorName;

      const cleanPayload = sanitizeJournalPayload(
        {
          ...journal,
          id: jId,
          chantierId: cId,
          signatureControleur: null,
          signatureLecteur: null,
        },
        liveChantier,
        validAuthorId,
        resolvedAuthorName,
        !validCreatedAt,
        validCreatedAt
      );
      await setDoc(ref, cleanPayload);
      return;
    }

    const status: JournalStatus =
      journal.status === 'completed' ? 'completed' : 'in_progress';

    await updateDoc(ref, {
      status,
      journalNum: Math.max(1, Math.min(99999, Number(journal.journalNum) || 1)),
      date: clampStr(journal.date, 20),
      horaireDebut: clampStr(journal.horaireDebut, 20),
      horaireFin: clampStr(journal.horaireFin, 20),
      tempMatin: clampStr(journal.tempMatin, 20),
      tempApresMidi: clampStr(journal.tempApresMidi, 20),
      etatAtmo: clampStrList(journal.etatAtmo, 20, 160),
      ouvriers: (Array.isArray(journal.ouvriers) ? journal.ouvriers : [])
        .slice(0, 100)
        .map((o) => ({
          firme: clampStr(o?.firme, 150),
          metier: clampStr(o?.metier, 150),
          nbre: Math.max(0, Math.min(9999, Number(o?.nbre) || 0)),
        })),
      travaux: clampStrList(journal.travaux, 200, 600),
      materiel: clampStrList(journal.materiel, 200, 400),
      materiaux: clampStrList(journal.materiaux, 200, 400),
      essais: clampStrList(journal.essais, 200, 400),
      evenements: clampStrList(journal.evenements, 200, 500),
      decisions: clampStrList(journal.decisions, 200, 500),
      visites: clampStrList(journal.visites, 200, 400),
      sigEntrepreneur: clampStr(journal.sigEntrepreneur, 150),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('déjà été signée par un membre')
    ) {
      throw error;
    }
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `chantiers/${cId}/journaux/${jId}`
    );
  }
}

export async function signJournalPageCloud(
  chantierId: string,
  journalId: string,
  role: 'controleur' | 'lecteur',
  signature: PageSignatureRecord,
  chantier?: Chantier,
  journal?: Journal,
  user?: User | null
): Promise<void> {
  const cId = sanitizeDocId(chantierId);
  const jId = sanitizeDocId(journalId);
  const ref = doc(db, 'chantiers', cId, 'journaux', jId);
  let diagInfo: Record<string, unknown> = { role, cId, jId };

  try {
    const serverSnap = await getDocFromServer(ref);
    if (!serverSnap.exists()) {
      diagInfo = { ...diagInfo, serverExists: false };
      if (role === 'controleur' && chantier && journal && user) {
        const liveChantier = await resolveLiveChantierReaders(chantier, cId);
        const authorName =
          user.displayName || user.email?.split('@')[0] || signature.signerName || 'Utilisateur';
        const createPayload = sanitizeJournalPayload(
          {
            ...journal,
            id: jId,
            chantierId: cId,
            status: 'completed',
            signatureControleur: null,
            signatureLecteur: null,
          },
          liveChantier,
          user.uid,
          authorName,
          true
        );
        await setDoc(ref, createPayload);
        await updateDoc(doc(db, 'chantiers', cId), {
          journalIds: arrayUnion(jId),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        await updateDoc(ref, {
          signatureControleur: signature,
          status: 'completed',
          updatedAt: serverTimestamp(),
        });
        return;
      }
      throw new Error(
        'Ce journal n’est pas encore synchronisé sur le serveur. Actualisez la page et réessayez.'
      );
    }

    const serverData = serverSnap.data();
    diagInfo = {
      ...diagInfo,
      serverExists: true,
      serverKeys: Object.keys(serverData).sort(),
      hasCreatedAtTs: isFirestoreTimestamp(serverData.createdAt),
      hasValidAuthorId: isValidFirestoreIdValue(serverData.authorId),
      chantierOwnerMatchesUser: serverData.chantierOwnerId === user?.uid,
      statusOnServer: serverData.status,
    };

    if (role === 'controleur') {
      const hasValidCtrlSig =
        serverData.signatureControleur != null &&
        typeof serverData.signatureControleur === 'object' &&
        isValidFirestoreIdValue(
          (serverData.signatureControleur as Record<string, unknown>).signerUid
        );

      if (hasValidCtrlSig) {
        throw new Error(
          'Cette page est déjà signée par le contrôleur. Cliquez sur Actualiser.'
        );
      }

      const hasValidReaderSig =
        serverData.signatureLecteur != null &&
        typeof serverData.signatureLecteur === 'object' &&
        isValidFirestoreIdValue(
          (serverData.signatureLecteur as Record<string, unknown>).signerUid
        );

      // When reader hasn't signed yet, always write a complete sanitized document via setDoc
      // so any legacy/missing/extra fields are healed atomically together with signatureControleur.
      if (!hasValidReaderSig && chantier && journal && user) {
        const liveChantier = await resolveLiveChantierReaders(chantier, cId);
        const validCreatedAt = isFirestoreTimestamp(serverData.createdAt)
          ? serverData.createdAt
          : undefined;
        const validAuthorId = isValidFirestoreIdValue(serverData.authorId)
          ? serverData.authorId
          : user.uid;
        const resolvedAuthorName =
          typeof serverData.authorName === 'string' &&
          serverData.authorName.trim() &&
          serverData.authorName.length <= 120
            ? serverData.authorName
            : clampStr(
                journal.authorName ||
                  user.displayName ||
                  signature.signerName ||
                  'Contrôleur',
                120
              );

        const fullPayload = sanitizeJournalPayload(
          {
            ...journal,
            id: jId,
            chantierId: cId,
            status: 'completed',
            signatureControleur: signature,
            signatureLecteur: null,
          },
          liveChantier,
          validAuthorId,
          resolvedAuthorName,
          !validCreatedAt,
          validCreatedAt
        );
        diagInfo = {
          ...diagInfo,
          writeMode: 'setDoc_full',
          liveOwnerMatchesUser: liveChantier.ownerId === user.uid,
          usedExistingCreatedAt: Boolean(validCreatedAt),
        };
        await setDoc(ref, fullPayload);
        return;
      }

      const patch: Record<string, unknown> = {
        signatureControleur: signature,
        status: 'completed',
        updatedAt: serverTimestamp(),
      };
      if (!hasValidReaderSig && serverData.signatureLecteur !== null) {
        patch.signatureLecteur = null;
      }
      if (!isBoundedStringArray(serverData.chantierReaderIds, 25)) {
        patch.chantierReaderIds = clampStrList(
          chantier?.readerIds || [],
          25,
          128
        ).filter((id) => /^[a-zA-Z0-9_-]+$/.test(id));
      }
      if (!isBoundedStringArray(serverData.chantierReaderEmails, 3)) {
        patch.chantierReaderEmails = clampEmailList(
          chantier?.readerEmails || [],
          3
        );
      }
      if (!isValidFirestoreIdValue(serverData.authorId)) {
        patch.authorId =
          user?.uid ||
          (isValidFirestoreIdValue(serverData.chantierOwnerId)
            ? serverData.chantierOwnerId
            : chantier?.ownerId) ||
          signature.signerUid;
      }
      if (
        typeof serverData.authorName !== 'string' ||
        !serverData.authorName.trim() ||
        serverData.authorName.length > 120
      ) {
        patch.authorName = clampStr(
          journal?.authorName || signature.signerName || 'Contrôleur',
          120
        );
      }
      if (!isFirestoreTimestamp(serverData.createdAt)) {
        patch.createdAt = serverTimestamp();
      }

      diagInfo = { ...diagInfo, writeMode: 'updateDoc_patch', patchKeys: Object.keys(patch) };
      await updateDoc(ref, patch);
      return;
    }

    // Reader (lecteur) role
    if (serverData.signatureLecteur != null) {
      throw new Error(
        'Cette page est déjà signée par le lecteur autorisé. Cliquez sur Actualiser.'
      );
    }
    if (serverData.status !== 'completed') {
      throw new Error(
        'Cette page n’est pas encore marquée comme terminée sur le serveur.'
      );
    }

    diagInfo = { ...diagInfo, writeMode: 'updateDoc_reader' };
    await updateDoc(ref, {
      signatureLecteur: signature,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      !error.message.includes('permission') &&
      !error.message.includes('Missing or insufficient') &&
      (error.message.includes('déjà signée') ||
        error.message.includes('pas encore') ||
        error.message.includes('synchronisé'))
    ) {
      throw error;
    }
    console.error('signJournalPageCloud diag:', JSON.stringify(diagInfo));
    const baseMsg = error instanceof Error ? error.message : String(error);
    const enriched = new Error(`${baseMsg} | diag=${JSON.stringify(diagInfo)}`);
    handleFirestoreError(
      enriched,
      OperationType.UPDATE,
      `chantiers/${cId}/journaux/${jId}`
    );
  }
}

export async function deleteJournalCloud(
  chantierId: string,
  journalId: string
): Promise<void> {
  const cId = sanitizeDocId(chantierId);
  const jId = sanitizeDocId(journalId);
  try {
    await deleteDoc(doc(db, 'chantiers', cId, 'journaux', jId));
    await updateDoc(doc(db, 'chantiers', cId), {
      journalIds: arrayRemove(jId),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `chantiers/${cId}/journaux/${jId}`
    );
  }
}

// ---------------------------------------------------------------------------
// Temporary Share Invites & Grants (Validity in MONTHS, default 36 = 3 ans)
// ---------------------------------------------------------------------------

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let suffix = '';
  for (let i = 0; i < bytes.length; i++) {
    suffix += chars[bytes[i] % chars.length];
  }
  return `JDT-${suffix}`;
}

export async function createShareInvite(
  chantier: Chantier,
  user: User,
  label: string,
  durationMonths: number
): Promise<ShareInvite> {
  const safeMonths = Math.max(1, Math.min(120, Math.round(durationMonths)));
  const code = generateInviteCode();
  const expiresAtDate = new Date();
  expiresAtDate.setMonth(expiresAtDate.getMonth() + safeMonths);
  const expiresTs = Timestamp.fromDate(expiresAtDate);
  const ownerName =
    user.displayName || user.email?.split('@')[0] || 'Contrôleur INASEP';

  const payload = {
    code,
    chantierId: sanitizeDocId(chantier.id),
    chantierNumero: clampStr(chantier.numero, 100),
    chantierProjet: clampStr(chantier.projet, 250),
    ownerId: user.uid,
    ownerName: clampStr(ownerName, 120),
    label: clampStr(label.trim() || 'Lecteur temporaire', 150),
    active: true,
    usedByUid: '',
    expiresAt: expiresTs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'shareInvites', code), payload);
    return {
      code,
      chantierId: payload.chantierId,
      chantierNumero: payload.chantierNumero,
      chantierProjet: payload.chantierProjet,
      ownerId: payload.ownerId,
      ownerName: payload.ownerName,
      label: payload.label,
      active: true,
      usedByUid: '',
      expiresAtMs: expiresAtDate.getTime(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `shareInvites/${code}`);
  }
}

export async function fetchOwnerShareDataOnce(
  chantierId: string,
  ownerId: string
): Promise<{ invites: ShareInvite[]; shares: ChantierShare[] }> {
  try {
    const [invSnap, shSnap] = await Promise.all([
      getDocs(
        query(collection(db, 'shareInvites'), where('ownerId', '==', ownerId))
      ),
      getDocs(
        query(
          collection(db, 'chantierShares'),
          where('chantierOwnerId', '==', ownerId)
        )
      ),
    ]);

    const invites: ShareInvite[] = invSnap.docs
      .map((d) => {
        const raw = d.data();
        return {
          code: String(raw.code || d.id),
          chantierId: String(raw.chantierId),
          chantierNumero: String(raw.chantierNumero || ''),
          chantierProjet: String(raw.chantierProjet || ''),
          ownerId: String(raw.ownerId),
          ownerName: String(raw.ownerName || ''),
          label: String(raw.label || ''),
          active: Boolean(raw.active),
          usedByUid: String(raw.usedByUid || ''),
          expiresAtMs: raw.expiresAt?.toMillis?.() ?? 0,
        };
      })
      .filter((inv) => inv.chantierId === chantierId)
      .sort((a, b) => b.expiresAtMs - a.expiresAtMs);

    const shares: ChantierShare[] = shSnap.docs
      .map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id || d.id),
          chantierId: String(raw.chantierId),
          chantierOwnerId: String(raw.chantierOwnerId),
          inviteCode: String(raw.inviteCode),
          readerUid: String(raw.readerUid),
          readerName: String(raw.readerName || ''),
          label: String(raw.label || ''),
          revoked: Boolean(raw.revoked),
          expiresAtMs: raw.expiresAt?.toMillis?.() ?? 0,
        };
      })
      .filter((s) => s.chantierId === chantierId)
      .sort((a, b) => b.expiresAtMs - a.expiresAtMs);

    return { invites, shares };
  } catch {
    return { invites: [], shares: [] };
  }
}

export async function redeemShareInvite(
  rawCode: string,
  user: User
): Promise<{ chantierId: string; chantierProjet: string }> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(code)) {
    throw new Error("Format de code d'accès invalide.");
  }

  const inviteRef = doc(db, 'shareInvites', code);
  const inviteSnap = await getDocFromServer(inviteRef);
  if (!inviteSnap.exists()) {
    throw new Error("Ce code d'accès temporaire n'existe pas ou a été supprimé.");
  }

  const inv = inviteSnap.data();
  const expiresAtMs = inv.expiresAt?.toMillis?.() ?? 0;
  if (!inv.active) {
    throw new Error("Ce code d'accès temporaire a été révoqué.");
  }
  if (expiresAtMs <= Date.now()) {
    throw new Error("Ce code d'accès temporaire a expiré.");
  }
  if (inv.ownerId === user.uid) {
    throw new Error('Vous êtes déjà propriétaire de ce chantier.');
  }
  if (inv.usedByUid && inv.usedByUid !== user.uid) {
    throw new Error("Ce code d'accès a déjà été utilisé par un autre compte.");
  }

  const chantierId = String(inv.chantierId);
  const shareId = `${chantierId}_${user.uid}`;
  const shareRef = doc(db, 'chantierShares', shareId);
  const readerName = clampStr(
    user.displayName || user.email?.split('@')[0] || 'Lecteur',
    120
  );

  try {
    if (!inv.usedByUid) {
      await updateDoc(inviteRef, {
        usedByUid: user.uid,
        updatedAt: serverTimestamp(),
      });
    }

    const existingShare = await getDocFromServer(shareRef);
    if (!existingShare.exists()) {
      await setDoc(shareRef, {
        id: shareId,
        chantierId,
        chantierOwnerId: String(inv.ownerId),
        inviteCode: code,
        readerUid: user.uid,
        readerName,
        label: clampStr(inv.label || readerName, 150),
        revoked: false,
        expiresAt: inv.expiresAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(shareRef, {
        inviteCode: code,
        expiresAt: inv.expiresAt,
        revoked: false,
        label: clampStr(inv.label || readerName, 150),
        readerName,
        updatedAt: serverTimestamp(),
      });
    }

    const chRef = doc(db, 'chantiers', chantierId);
    await updateDoc(chRef, {
      readerIds: arrayUnion(user.uid),
      updatedAt: serverTimestamp(),
    });

    const chSnap = await getDocFromServer(chRef);
    const knownJournalIds: string[] = Array.isArray(chSnap.data()?.journalIds)
      ? chSnap.data()!.journalIds
      : [];

    if (knownJournalIds.length > 0) {
      for (let i = 0; i < knownJournalIds.length; i += 350) {
        const chunk = knownJournalIds.slice(i, i + 350);
        const batch = writeBatch(db);
        chunk.forEach((jId) => {
          batch.update(doc(db, 'chantiers', chantierId, 'journaux', jId), {
            chantierReaderIds: arrayUnion(user.uid),
            updatedAt: serverTimestamp(),
          });
        });
        try {
          await batch.commit();
        } catch {
          await Promise.all(
            chunk.map((jId) =>
              updateDoc(doc(db, 'chantiers', chantierId, 'journaux', jId), {
                chantierReaderIds: arrayUnion(user.uid),
                updatedAt: serverTimestamp(),
              }).catch(() => {})
            )
          );
        }
      }
    }

    return {
      chantierId,
      chantierProjet: String(
        inv.chantierProjet || inv.chantierNumero || chantierId
      ),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `chantierShares/${shareId}`
    );
  }
}

export async function revokeChantierShare(share: ChantierShare): Promise<void> {
  try {
    await updateDoc(doc(db, 'chantierShares', share.id), {
      revoked: true,
      updatedAt: serverTimestamp(),
    });
    if (share.inviteCode) {
      try {
        await updateDoc(doc(db, 'shareInvites', share.inviteCode), {
          active: false,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // ignore if already deleted
      }
    }
    await updateDoc(doc(db, 'chantiers', share.chantierId), {
      readerIds: arrayRemove(share.readerUid),
      updatedAt: serverTimestamp(),
    });
    const jSnap = await getDocs(
      query(
        collection(db, 'chantiers', share.chantierId, 'journaux'),
        where('chantierOwnerId', '==', share.chantierOwnerId)
      )
    );
    for (let i = 0; i < jSnap.docs.length; i += 350) {
      const batch = writeBatch(db);
      jSnap.docs.slice(i, i + 350).forEach((d) => {
        batch.update(d.ref, {
          chantierReaderIds: arrayRemove(share.readerUid),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `chantierShares/${share.id}`
    );
  }
}

export async function redeemDossierPinCode(
  chantierIdOrUrl: string,
  rawPinCode: string,
  user: User
): Promise<{ chantierId: string; chantierProjet: string }> {
  const chantierId = extractChantierIdFromInput(chantierIdOrUrl);
  const pinCode = normalizeDossierPinCode(rawPinCode);

  if (!chantierId) {
    throw new Error(
      'Ouvrez le lien complet reçu par e-mail (ou collez-le dans le champ Dossier) pour identifier le chantier.'
    );
  }
  if (!pinCode) {
    throw new Error('Le code d’accès du dossier doit contenir exactement 6 chiffres.');
  }

  const accessId = `${chantierId}_${pinCode}`;
  const accessRef = doc(db, 'dossier_access', accessId);

  let grantData: Record<string, unknown>;
  try {
    const snap = await getDocFromServer(accessRef);
    if (!snap.exists()) {
      throw new Error(
        'Code d’accès à 6 chiffres incorrect pour ce dossier. Vérifiez le code reçu par e-mail.'
      );
    }
    grantData = snap.data();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Code d’accès')) {
      throw err;
    }
    if (isOfflineError(err)) {
      throw new Error('Connexion Internet requise pour valider ce code de dossier.');
    }
    if (isQuotaExceededError(err)) {
      throw new Error('Quota Firestore temporairement dépassé. Réessayez plus tard.');
    }
    throw new Error(
      'Code d’accès incorrect ou accès refusé pour ce dossier. Vérifiez le lien et le code à 6 chiffres.'
    );
  }

  const expiresAtMs = (grantData.expiresAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
  if (!grantData.active) {
    throw new Error('Ce code d’accès a été désactivé par le contrôleur.');
  }
  if (expiresAtMs <= Date.now()) {
    throw new Error('Ce code d’accès a expiré.');
  }
  if (grantData.ownerId === user.uid) {
    return {
      chantierId,
      chantierProjet: String(
        grantData.chantierProjet || grantData.chantierNumero || chantierId
      ),
    };
  }

  const shareId = `${chantierId}_${user.uid}`;
  const shareRef = doc(db, 'chantierShares', shareId);
  const readerName = clampStr(
    user.displayName || user.email?.split('@')[0] || 'Entrepreneur',
    120
  );

  try {
    const existingShare = await getDocFromServer(shareRef).catch(() => null);
    if (!existingShare || !existingShare.exists()) {
      await setDoc(shareRef, {
        id: shareId,
        chantierId,
        chantierOwnerId: String(grantData.ownerId),
        inviteCode: pinCode,
        readerUid: user.uid,
        readerName,
        label: clampStr(`Accès dossier (${user.email || readerName})`, 150),
        revoked: false,
        expiresAt: grantData.expiresAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(shareRef, {
        inviteCode: pinCode,
        expiresAt: grantData.expiresAt,
        revoked: false,
        label: clampStr(`Accès dossier (${user.email || readerName})`, 150),
        readerName,
        updatedAt: serverTimestamp(),
      });
    }

    const chRef = doc(db, 'chantiers', chantierId);
    await updateDoc(chRef, {
      readerIds: arrayUnion(user.uid),
      updatedAt: serverTimestamp(),
    });

    const chSnap = await getDocFromServer(chRef);
    const knownJournalIds: string[] = Array.isArray(chSnap.data()?.journalIds)
      ? chSnap.data()!.journalIds
      : [];

    if (knownJournalIds.length > 0) {
      for (let i = 0; i < knownJournalIds.length; i += 350) {
        const chunk = knownJournalIds.slice(i, i + 350);
        const batch = writeBatch(db);
        chunk.forEach((jId) => {
          batch.update(doc(db, 'chantiers', chantierId, 'journaux', jId), {
            chantierReaderIds: arrayUnion(user.uid),
            updatedAt: serverTimestamp(),
          });
        });
        try {
          await batch.commit();
        } catch {
          await Promise.all(
            chunk.map((jId) =>
              updateDoc(doc(db, 'chantiers', chantierId, 'journaux', jId), {
                chantierReaderIds: arrayUnion(user.uid),
                updatedAt: serverTimestamp(),
              }).catch(() => {})
            )
          );
        }
      }
    }

    setCachedReaderAccess(user.uid, true);
    return {
      chantierId,
      chantierProjet: String(
        grantData.chantierProjet || grantData.chantierNumero || chantierId
      ),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `chantierShares/${shareId}`
    );
  }
}

export async function deactivateShareInvite(code: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'shareInvites', code), {
      active: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shareInvites/${code}`);
  }
}

export async function importLocalDbToCloud(
  localDb: DB,
  user: User,
  existingIds: Set<string>
): Promise<{ importedChantiers: number; importedJournaux: number }> {
  const ownerName =
    user.displayName || user.email?.split('@')[0] || 'Utilisateur';
  let importedChantiers = 0;
  let importedJournaux = 0;

  for (const ch of localDb.chantiers) {
    const cId = sanitizeDocId(ch.id);
    if (existingIds.has(cId)) continue;

    const childJournals = localDb.journaux.filter((j) => j.chantierId === ch.id);
    const childJournalIds = childJournals.map((j) => sanitizeDocId(j.id));

    const cRef = doc(db, 'chantiers', cId);
    const cPayload = sanitizeChantierPayload(
      { ...ch, id: cId, visibility: 'private', readerIds: [] },
      user.uid,
      ownerName,
      true
    );
    cPayload.journalIds = childJournalIds.slice(0, 1000);

    try {
      await setDoc(cRef, cPayload);
      importedChantiers += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `chantiers/${cId}`);
    }

    for (let i = 0; i < childJournals.length; i += 350) {
      const batch = writeBatch(db);
      for (const j of childJournals.slice(i, i + 350)) {
        const jId = sanitizeDocId(j.id);
        const jRef = doc(db, 'chantiers', cId, 'journaux', jId);
        const jPayload = sanitizeJournalPayload(
          { ...j, id: jId, chantierId: cId },
          {
            ...ch,
            id: cId,
            ownerId: user.uid,
            visibility: 'private',
            readerIds: [],
          },
          user.uid,
          ownerName,
          true
        );
        batch.set(jRef, jPayload);
        importedJournaux += 1;
      }
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.WRITE,
          `chantiers/${cId}/journaux`
        );
      }
    }
  }

  return { importedChantiers, importedJournaux };
}
