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

// ---------------------------------------------------------------------------
// Offline Cache Helpers (localStorage — 0 Firestore reads on cached reload)
// ---------------------------------------------------------------------------

const ACCESS_CACHE_PREFIX = 'jt_access_approved_v1_';
const CHANTIERS_CACHE_PREFIX = 'jt_chantiers_cache_v1_';
const JOURNALS_CACHE_PREFIX = 'jt_journals_cache_v1_';

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

  return {
    id: sanitizeDocId(ch.id),
    ownerId,
    ownerName: clampStr(ownerName, 120),
    visibility: 'private' as const,
    readerIds,
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

  const status: JournalStatus =
    j.status === 'completed' ? 'completed' : 'in_progress';

  return {
    id: sanitizeDocId(j.id),
    chantierId: sanitizeDocId(chantier.id),
    chantierOwnerId: chantier.ownerId || authorId,
    chantierReaderIds,
    authorId,
    authorName: clampStr(authorName, 120),
    status,
    journalNum: Math.max(1, Math.min(99999, Number(j.journalNum) || 1)),
    date: clampStr(j.date, 20),
    horaireDebut: clampStr(j.horaireDebut, 20),
    horaireFin: clampStr(j.horaireFin, 20),
    tempMatin: clampStr(j.tempMatin, 20),
    tempApresMidi: clampStr(j.tempApresMidi, 20),
    etatAtmo: clampStrList(j.etatAtmo, 20, 40),
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

export async function fetchChantiersAndSharesOnce(userId: string): Promise<{
  chantiers: Chantier[];
  shareByChantierId: Record<string, ChantierShare>;
  fromCache?: boolean;
}> {
  try {
    const [ownedSnap, sharesSnap] = await Promise.all([
      getDocsFromServer(
        query(collection(db, 'chantiers'), where('ownerId', '==', userId))
      ),
      getDocsFromServer(
        query(
          collection(db, 'chantierShares'),
          where('readerUid', '==', userId)
        )
      ),
    ]);

    const merged = new Map<string, Chantier>();
    ownedSnap.docs.forEach((d) => merged.set(d.id, d.data() as Chantier));

    const now = Date.now();
    const shareByChantierId: Record<string, ChantierShare> = {};
    const activeSharedIds: string[] = [];

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
  userId: string
): Promise<Journal[]> {
  const col = collection(db, 'chantiers', chantier.id, 'journaux');
  const q =
    chantier.ownerId === userId
      ? query(col, where('chantierOwnerId', '==', userId))
      : query(col, where('chantierReaderIds', 'array-contains', userId));

  try {
    const snap = await getDocsFromServer(q);
    const list = snap.docs
      .map((d) => {
        const raw = d.data() as Journal;
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

export async function saveChantierCloud(
  chantier: Chantier,
  user: User
): Promise<Chantier> {
  const id = sanitizeDocId(chantier.id);
  const ref = doc(db, 'chantiers', id);

  try {
    const snap = await getDoc(ref);
    const ownerName =
      chantier.ownerName ||
      user.displayName ||
      user.email?.split('@')[0] ||
      'Utilisateur';

    if (!snap.exists()) {
      const payload = sanitizeChantierPayload(
        { ...chantier, id },
        user.uid,
        ownerName,
        true
      );
      await setDoc(ref, payload);
      return {
        ...chantier,
        id,
        ownerId: user.uid,
        ownerName,
        visibility: 'private',
        readerIds: payload.readerIds,
      };
    }

    const existingData = snap.data() as Chantier;
    const updateFields: Record<string, unknown> = {
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

    await updateDoc(ref, updateFields);

    return {
      ...chantier,
      id,
      ownerId: existingData.ownerId,
      ownerName: existingData.ownerName,
      visibility: 'private',
      readerIds: existingData.readerIds || [],
    };
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
      const payload = sanitizeJournalPayload(
        { ...journal, id: jId, chantierId: cId },
        { ...chantier, id: cId },
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
      etatAtmo: clampStrList(journal.etatAtmo, 20, 40),
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
  signature: PageSignatureRecord
): Promise<void> {
  const cId = sanitizeDocId(chantierId);
  const jId = sanitizeDocId(journalId);
  const ref = doc(db, 'chantiers', cId, 'journaux', jId);

  try {
    const fieldName =
      role === 'controleur' ? 'signatureControleur' : 'signatureLecteur';
    await updateDoc(ref, {
      [fieldName]: signature,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
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
        const batch = writeBatch(db);
        knownJournalIds.slice(i, i + 350).forEach((jId) => {
          batch.update(doc(db, 'chantiers', chantierId, 'journaux', jId), {
            chantierReaderIds: arrayUnion(user.uid),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
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
