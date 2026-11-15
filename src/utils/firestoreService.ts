import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut as firebaseSignOut,
  updateProfile as updateAuthProfile,
  type User,
} from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  getSecondaryAuth,
  handleFirestoreError,
  isAdminEmail,
  OperationType,
} from '../firebase';
import type {
  Chantier,
  ChantierShare,
  DB,
  Journal,
  JournalStatus,
  PageSignatureRecord,
  ShareInvite,
  UserProfile,
} from '../types';
import { uid } from './storage';

export function sanitizeDocId(raw?: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 120);
  return cleaned || uid();
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

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userRef = doc(db, 'users', user.uid);
  const privRef = doc(db, 'users', user.uid, 'private', 'info');
  const isSoleAdmin = isAdminEmail(user.email);
  const defaultName =
    user.displayName?.trim() ||
    (isSoleAdmin ? 'Fabien Pirquin' : user.email?.split('@')[0]) ||
    'Utilisateur INASEP';
  const expectedRole: 'admin' | 'user' = isSoleAdmin ? 'admin' : 'user';
  const defaultPreposeInit = isSoleAdmin ? 'F. Pirquin' : '';

  try {
    const snap = await getDoc(userRef);
    let profile: UserProfile = {
      uid: user.uid,
      displayName: defaultName,
      email: user.email || undefined,
      role: expectedRole,
      active: isSoleAdmin, // Self-registered users wait for Admin approval
      defaultPrepose: defaultPreposeInit,
      defaultHoraireDebut: '07:30',
      defaultHoraireFin: '16:30',
    };

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: clampStr(defaultName, 120),
        role: expectedRole,
        active: isSoleAdmin,
        defaultPrepose: clampStr(defaultPreposeInit, 150),
        defaultHoraireDebut: '07:30',
        defaultHoraireFin: '16:30',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const data = snap.data();
      profile = {
        uid: user.uid,
        displayName: String(data.displayName || defaultName),
        email: user.email || undefined,
        role: isSoleAdmin ? 'admin' : 'user',
        active: isSoleAdmin
          ? true
          : typeof data.active === 'boolean'
            ? data.active
            : false,
        defaultPrepose: String(data.defaultPrepose ?? defaultPreposeInit),
        defaultHoraireDebut: String(data.defaultHoraireDebut ?? '07:30'),
        defaultHoraireFin: String(data.defaultHoraireFin ?? '16:30'),
      };
    }

    if (user.email) {
      const privSnap = await getDoc(privRef);
      if (!privSnap.exists()) {
        await setDoc(privRef, {
          email: clampStr(user.email, 200),
          updatedAt: serverTimestamp(),
        });
      } else if (privSnap.data().email !== user.email) {
        await updateDoc(privRef, {
          email: clampStr(user.email, 200),
          updatedAt: serverTimestamp(),
        });
      }
    }

    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
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
  try {
    if (auth.currentUser && auth.currentUser.uid === userId) {
      await updateAuthProfile(auth.currentUser, {
        displayName: clampStr(patch.displayName.trim(), 120),
      });
    }
    await updateDoc(userRef, {
      displayName: clampStr(patch.displayName.trim() || 'Utilisateur', 120),
      defaultPrepose: clampStr(patch.defaultPrepose.trim(), 150),
      defaultHoraireDebut: clampStr(patch.defaultHoraireDebut || '07:30', 20),
      defaultHoraireFin: clampStr(patch.defaultHoraireFin || '16:30', 20),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function createUserAccountAdmin(params: {
  displayName: string;
  email: string;
  password: string;
  defaultPrepose?: string;
}): Promise<UserProfile> {
  const secondaryAuth = getSecondaryAuth();
  const cleanEmail = params.email.trim();
  const cleanName = params.displayName.trim() || cleanEmail.split('@')[0];

  const cred = await createUserWithEmailAndPassword(
    secondaryAuth,
    cleanEmail,
    params.password
  );
  await updateAuthProfile(cred.user, { displayName: cleanName });
  try {
    await sendEmailVerification(cred.user);
  } catch {
    // non-fatal if mail throttle occurs
  }
  const newUid = cred.user.uid;
  await firebaseSignOut(secondaryAuth);

  // Admin writes the pre-approved user profile using primary Admin Firestore session
  try {
    await setDoc(doc(db, 'users', newUid), {
      uid: newUid,
      displayName: clampStr(cleanName, 120),
      role: 'user',
      active: true,
      defaultPrepose: clampStr(params.defaultPrepose || cleanName, 150),
      defaultHoraireDebut: '07:30',
      defaultHoraireFin: '16:30',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'users', newUid, 'private', 'info'), {
      email: clampStr(cleanEmail, 200),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `users/${newUid}`);
  }

  return {
    uid: newUid,
    displayName: cleanName,
    email: cleanEmail,
    role: 'user',
    active: true,
    defaultPrepose: params.defaultPrepose || cleanName,
    defaultHoraireDebut: '07:30',
    defaultHoraireFin: '16:30',
  };
}

export async function updateUserAdmin(
  userId: string,
  patch: { active: boolean }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', userId), {
      active: patch.active,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function deleteUserProfileAdmin(userId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', userId, 'private', 'info'));
    await deleteDoc(doc(db, 'users', userId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
  }
}

export function subscribeChantiers(
  userId: string,
  onData: (payload: {
    chantiers: Chantier[];
    shareByChantierId: Record<string, ChantierShare>;
  }) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const ownedMap = new Map<string, Chantier>();
  const sharedMap = new Map<string, Chantier>();
  const shareByChantierId = new Map<string, ChantierShare>();
  const sharedDocUnsubs = new Map<string, Unsubscribe>();

  const emit = () => {
    const merged = new Map<string, Chantier>();
    ownedMap.forEach((v, k) => merged.set(k, v));
    sharedMap.forEach((v, k) => {
      if (!merged.has(k)) merged.set(k, v);
    });
    const list = Array.from(merged.values()).sort((a, b) =>
      (a.numero || a.projet || '').localeCompare(b.numero || b.projet || '')
    );
    const shareObj: Record<string, ChantierShare> = {};
    shareByChantierId.forEach((v, k) => {
      shareObj[k] = v;
    });
    onData({ chantiers: list, shareByChantierId: shareObj });
  };

  // 1. User's strictly private owned chantiers
  const unsubOwned = onSnapshot(
    query(collection(db, 'chantiers'), where('ownerId', '==', userId)),
    (snap) => {
      ownedMap.clear();
      snap.docs.forEach((d) => ownedMap.set(d.id, d.data() as Chantier));
      emit();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'chantiers(owned)');
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );

  // 2. Temporary read-access shares granted to this user
  const unsubShares = onSnapshot(
    query(collection(db, 'chantierShares'), where('readerUid', '==', userId)),
    (snap) => {
      const now = Date.now();
      const activeIds = new Set<string>();
      shareByChantierId.clear();

      snap.docs.forEach((d) => {
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
          activeIds.add(share.chantierId);
          shareByChantierId.set(share.chantierId, share);

          if (!sharedDocUnsubs.has(share.chantierId)) {
            const unsubCh = onSnapshot(
              doc(db, 'chantiers', share.chantierId),
              (chSnap) => {
                if (chSnap.exists()) {
                  sharedMap.set(share.chantierId, chSnap.data() as Chantier);
                } else {
                  sharedMap.delete(share.chantierId);
                }
                emit();
              },
              () => {
                sharedMap.delete(share.chantierId);
                emit();
              }
            );
            sharedDocUnsubs.set(share.chantierId, unsubCh);
          }
        }
      });

      // Clean up expired or revoked listeners
      Array.from(sharedDocUnsubs.keys()).forEach((cId) => {
        if (!activeIds.has(cId)) {
          sharedDocUnsubs.get(cId)?.();
          sharedDocUnsubs.delete(cId);
          sharedMap.delete(cId);
        }
      });

      emit();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'chantierShares(reader)');
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );

  return () => {
    unsubOwned();
    unsubShares();
    sharedDocUnsubs.forEach((u) => u());
    sharedDocUnsubs.clear();
  };
}

export function subscribeChantierJournaux(
  chantier: Chantier,
  userId: string,
  onData: (journals: Journal[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const col = collection(db, 'chantiers', chantier.id, 'journaux');
  const q =
    chantier.ownerId === userId
      ? query(col, where('chantierOwnerId', '==', userId))
      : query(col, where('chantierReaderIds', 'array-contains', userId));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => {
        const raw = d.data() as Journal;
        return {
          ...raw,
          status: raw.status === 'completed' ? ('completed' as const) : ('in_progress' as const),
          signatureControleur: raw.signatureControleur ?? null,
          signatureLecteur: raw.signatureLecteur ?? null,
        };
      });
      list.sort(
        (a, b) =>
          (a.date || '').localeCompare(b.date || '') ||
          a.journalNum - b.journalNum
      );
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `chantiers/${chantier.id}/journaux`
        );
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
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

    const existingData = snap.data() as Chantier & { createdAt?: unknown };
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

export async function fetchAllJournalsForChantier(
  chantier: Chantier,
  userId: string
): Promise<Journal[]> {
  const col = collection(db, 'chantiers', chantier.id, 'journaux');
  const q =
    chantier.ownerId === userId
      ? query(col, where('chantierOwnerId', '==', userId))
      : query(col, where('chantierReaderIds', 'array-contains', userId));

  try {
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as Journal)
      .sort(
        (a, b) =>
          (a.date || '').localeCompare(b.date || '') ||
          a.journalNum - b.journalNum
      );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      `chantiers/${chantier.id}/journaux`
    );
  }
}

// Temporary Share Invites & Grants (strictly linked to 1 specific chantier)

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
  durationHours: number
): Promise<ShareInvite> {
  const code = generateInviteCode();
  const expiresAtDate = new Date(Date.now() + durationHours * 3600 * 1000);
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

export function subscribeOwnerShareInvites(
  chantierId: string,
  ownerId: string,
  onData: (invites: ShareInvite[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'shareInvites'),
    where('ownerId', '==', ownerId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
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
          } satisfies ShareInvite;
        })
        .filter((inv) => inv.chantierId === chantierId)
        .sort((a, b) => b.expiresAtMs - a.expiresAtMs);
      onData(list);
    },
    () => onData([])
  );
}

export function subscribeOwnerChantierShares(
  chantierId: string,
  ownerId: string,
  onData: (shares: ChantierShare[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'chantierShares'),
    where('chantierOwnerId', '==', ownerId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
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
          } satisfies ChantierShare;
        })
        .filter((s) => s.chantierId === chantierId)
        .sort((a, b) => b.expiresAtMs - a.expiresAtMs);
      onData(list);
    },
    () => onData([])
  );
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
  const inviteSnap = await getDoc(inviteRef);
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

    const existingShare = await getDoc(shareRef);
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

    // Bind readerUid to chantier and its journals so list queries match immediately
    const chRef = doc(db, 'chantiers', chantierId);
    await updateDoc(chRef, {
      readerIds: arrayUnion(user.uid),
      updatedAt: serverTimestamp(),
    });

    const chSnap = await getDoc(chRef);
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
      chantierProjet: String(inv.chantierProjet || inv.chantierNumero || chantierId),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chantierShares/${shareId}`);
  }
}

export async function syncPendingReadersToJournals(
  chantier: Chantier,
  ownerUid: string,
  activeReaderIds: string[]
): Promise<void> {
  if (chantier.ownerId !== ownerUid || !activeReaderIds.length) return;
  try {
    const chRef = doc(db, 'chantiers', chantier.id);
    const currentReaders = new Set(chantier.readerIds || []);
    const missingOnCh = activeReaderIds.filter((id) => !currentReaders.has(id));
    if (missingOnCh.length > 0) {
      await updateDoc(chRef, {
        readerIds: arrayUnion(...missingOnCh),
        updatedAt: serverTimestamp(),
      });
    }

    const jSnap = await getDocs(
      query(
        collection(db, 'chantiers', chantier.id, 'journaux'),
        where('chantierOwnerId', '==', ownerUid)
      )
    );
    const toUpdate = jSnap.docs.filter((d) => {
      const rIds: string[] = Array.isArray(d.data().chantierReaderIds)
        ? d.data().chantierReaderIds
        : [];
      return activeReaderIds.some((id) => !rIds.includes(id));
    });
    for (let i = 0; i < toUpdate.length; i += 350) {
      const batch = writeBatch(db);
      toUpdate.slice(i, i + 350).forEach((d) => {
        batch.update(d.ref, {
          chantierReaderIds: arrayUnion(...activeReaderIds),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch {
    // non-fatal background sync
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
        // invite may already be deleted
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

export async function fetchAllUsersAdmin(): Promise<UserProfile[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const profiles = await Promise.all(
      snap.docs.map(async (d) => {
        const pub = d.data() as UserProfile;
        let email: string | undefined;
        try {
          const privSnap = await getDoc(
            doc(db, 'users', d.id, 'private', 'info')
          );
          if (privSnap.exists()) {
            email = String(privSnap.data().email || '');
          }
        } catch {
          // ignore if missing
        }
        return {
          uid: pub.uid || d.id,
          displayName: pub.displayName || 'Utilisateur',
          role: pub.role === 'admin' ? ('admin' as const) : ('user' as const),
          active: typeof pub.active === 'boolean' ? pub.active : false,
          defaultPrepose: String(pub.defaultPrepose || ''),
          defaultHoraireDebut: String(pub.defaultHoraireDebut || '07:30'),
          defaultHoraireFin: String(pub.defaultHoraireFin || '16:30'),
          email,
        };
      })
    );
    return profiles.sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
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

    const cRef = doc(db, 'chantiers', cId);
    const cPayload = sanitizeChantierPayload(
      { ...ch, id: cId, visibility: 'private', readerIds: [] },
      user.uid,
      ownerName,
      true
    );
    try {
      await setDoc(cRef, cPayload);
      importedChantiers += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `chantiers/${cId}`);
    }

    const childJournals = localDb.journaux.filter((j) => j.chantierId === ch.id);
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
