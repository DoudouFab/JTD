import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut as firebaseSignOut,
  updateProfile as updateAuthProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
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
import type { Chantier, DB, Journal, UserProfile } from '../types';
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

function clampStrList(val: unknown, maxItems: number, maxItemLen = 500): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .slice(0, maxItems)
    .map((item) => clampStr(item, maxItemLen));
}

function sanitizeChantierPayload(
  ch: Chantier,
  ownerId: string,
  ownerName: string,
  isCreate: boolean,
  existingCreatedAt?: unknown
) {
  const visibility: 'team' | 'private' =
    ch.visibility === 'private' ? 'private' : 'team';
  const memberIds = clampStrList(ch.memberIds || [], 50, 128).filter((id) =>
    /^[a-zA-Z0-9_-]+$/.test(id)
  );

  return {
    id: sanitizeDocId(ch.id),
    ownerId,
    ownerName: clampStr(ownerName, 120),
    visibility,
    memberIds,
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
    createdAt: isCreate ? serverTimestamp() : existingCreatedAt || serverTimestamp(),
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

  const chantierVisibility: 'team' | 'private' =
    chantier.visibility === 'private' ? 'private' : 'team';
  const chantierMemberIds = clampStrList(chantier.memberIds || [], 50, 128).filter(
    (id) => /^[a-zA-Z0-9_-]+$/.test(id)
  );

  return {
    id: sanitizeDocId(j.id),
    chantierId: sanitizeDocId(chantier.id),
    chantierOwnerId: chantier.ownerId || authorId,
    chantierVisibility,
    chantierMemberIds,
    authorId,
    authorName: clampStr(authorName, 120),
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
    createdAt: isCreate ? serverTimestamp() : existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userRef = doc(db, 'users', user.uid);
  const privRef = doc(db, 'users', user.uid, 'private', 'info');
  const isDefaultAdmin = isAdminEmail(user.email);
  const defaultName =
    user.displayName?.trim() ||
    (isDefaultAdmin ? 'Fabien Pirquin' : user.email?.split('@')[0]) ||
    'Utilisateur INASEP';
  const expectedRole: 'admin' | 'user' = isDefaultAdmin ? 'admin' : 'user';
  const defaultPreposeInit = isDefaultAdmin ? 'F. Pirquin' : '';

  try {
    const snap = await getDoc(userRef);
    let profile: UserProfile = {
      uid: user.uid,
      displayName: defaultName,
      email: user.email || undefined,
      role: expectedRole,
      active: true,
      defaultPrepose: defaultPreposeInit,
      defaultHoraireDebut: '07:30',
      defaultHoraireFin: '16:30',
    };

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: clampStr(defaultName, 120),
        role: expectedRole,
        active: true,
        defaultPrepose: clampStr(defaultPreposeInit, 150),
        defaultHoraireDebut: '07:30',
        defaultHoraireFin: '16:30',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const data = snap.data();
      // Backfill legacy user docs that didn't have preferences fields yet
      const needsBackfill =
        typeof data.active !== 'boolean' ||
        data.defaultPrepose === undefined ||
        data.defaultHoraireDebut === undefined ||
        data.defaultHoraireFin === undefined;

      if (needsBackfill) {
        await updateDoc(userRef, {
          active: typeof data.active === 'boolean' ? data.active : true,
          defaultPrepose: clampStr(data.defaultPrepose ?? defaultPreposeInit, 150),
          defaultHoraireDebut: clampStr(data.defaultHoraireDebut ?? '07:30', 20),
          defaultHoraireFin: clampStr(data.defaultHoraireFin ?? '16:30', 20),
          updatedAt: serverTimestamp(),
        });
      }

      profile = {
        uid: user.uid,
        displayName: String(data.displayName || defaultName),
        email: user.email || undefined,
        role: data.role === 'admin' || isDefaultAdmin ? 'admin' : 'user',
        active: typeof data.active === 'boolean' ? data.active : true,
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
  role: 'admin' | 'user';
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

  // Admin writes the user profile using primary Admin Firestore session
  try {
    await setDoc(doc(db, 'users', newUid), {
      uid: newUid,
      displayName: clampStr(cleanName, 120),
      role: params.role,
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
    role: params.role,
    active: true,
    defaultPrepose: params.defaultPrepose || cleanName,
    defaultHoraireDebut: '07:30',
    defaultHoraireFin: '16:30',
  };
}

export async function updateUserAdmin(
  userId: string,
  patch: { role?: 'admin' | 'user'; active?: boolean }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', userId), {
      ...patch,
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
  isAdmin: boolean,
  onData: (chantiers: Chantier[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const col = collection(db, 'chantiers');

  if (isAdmin) {
    return onSnapshot(
      col,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Chantier);
        list.sort((a, b) =>
          (a.numero || a.projet || '').localeCompare(b.numero || b.projet || '')
        );
        onData(list);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'chantiers');
        } catch (wrapped) {
          onError?.(wrapped as Error);
        }
      }
    );
  }

  // Regular verified users: 3 filtered queries merged cleanly (zero get() in rules!)
  const buckets: Record<string, Map<string, Chantier>> = {
    team: new Map(),
    owned: new Map(),
    member: new Map(),
  };

  const emit = () => {
    const merged = new Map<string, Chantier>();
    buckets.team.forEach((v, k) => merged.set(k, v));
    buckets.owned.forEach((v, k) => merged.set(k, v));
    buckets.member.forEach((v, k) => merged.set(k, v));
    const list = Array.from(merged.values()).sort((a, b) =>
      (a.numero || a.projet || '').localeCompare(b.numero || b.projet || '')
    );
    onData(list);
  };

  const unsubs = [
    onSnapshot(
      query(col, where('visibility', '==', 'team')),
      (snap) => {
        buckets.team.clear();
        snap.docs.forEach((d) => buckets.team.set(d.id, d.data() as Chantier));
        emit();
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'chantiers(team)');
        } catch (wrapped) {
          onError?.(wrapped as Error);
        }
      }
    ),
    onSnapshot(
      query(col, where('ownerId', '==', userId)),
      (snap) => {
        buckets.owned.clear();
        snap.docs.forEach((d) => buckets.owned.set(d.id, d.data() as Chantier));
        emit();
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'chantiers(owned)');
        } catch (wrapped) {
          onError?.(wrapped as Error);
        }
      }
    ),
    onSnapshot(
      query(col, where('memberIds', 'array-contains', userId)),
      (snap) => {
        buckets.member.clear();
        snap.docs.forEach((d) =>
          buckets.member.set(d.id, d.data() as Chantier)
        );
        emit();
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'chantiers(member)');
        } catch (wrapped) {
          onError?.(wrapped as Error);
        }
      }
    ),
  ];

  return () => unsubs.forEach((u) => u());
}

export function subscribeChantierJournaux(
  chantier: Chantier,
  userId: string,
  isAdmin: boolean,
  onData: (journals: Journal[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const col = collection(db, 'chantiers', chantier.id, 'journaux');
  let q = query(col);

  if (!isAdmin) {
    if (chantier.ownerId === userId) {
      q = query(col, where('chantierOwnerId', '==', userId));
    } else if ((chantier.visibility || 'team') === 'team') {
      q = query(col, where('chantierVisibility', '==', 'team'));
    } else {
      q = query(col, where('chantierMemberIds', 'array-contains', userId));
    }
  }

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Journal);
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
  user: User,
  isAdmin: boolean
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
        visibility: payload.visibility,
        memberIds: payload.memberIds,
      };
    }

    const existingData = snap.data() as Chantier & { createdAt?: unknown };
    const isOwnerOrAdmin = isAdmin || existingData.ownerId === user.uid;
    const visibility = isOwnerOrAdmin
      ? chantier.visibility === 'private'
        ? 'private'
        : 'team'
      : existingData.visibility || 'team';
    const memberIds = isOwnerOrAdmin
      ? clampStrList(chantier.memberIds || [], 50, 128).filter((x) =>
          /^[a-zA-Z0-9_-]+$/.test(x)
        )
      : existingData.memberIds || [];

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

    if (isOwnerOrAdmin) {
      updateFields.visibility = visibility;
      updateFields.memberIds = memberIds;
    }

    await updateDoc(ref, updateFields);

    // Sync child journal visibility/members if owner/admin changed them
    if (
      isOwnerOrAdmin &&
      (visibility !== existingData.visibility ||
        JSON.stringify(memberIds) !==
          JSON.stringify(existingData.memberIds || []))
    ) {
      const jSnap = await getDocs(collection(db, 'chantiers', id, 'journaux'));
      const batch = writeBatch(db);
      jSnap.docs.forEach((jd) => {
        batch.update(jd.ref, {
          chantierVisibility: visibility,
          chantierMemberIds: memberIds,
          updatedAt: serverTimestamp(),
        });
      });
      if (!jSnap.empty) await batch.commit();
    }

    return {
      ...chantier,
      id,
      ownerId: existingData.ownerId,
      ownerName: existingData.ownerName,
      visibility,
      memberIds,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chantiers/${id}`);
  }
}

export async function deleteChantierCloud(chantierId: string): Promise<void> {
  const id = sanitizeDocId(chantierId);
  try {
    const jSnap = await getDocs(collection(db, 'chantiers', id, 'journaux'));
    // Batch delete up to 400 docs per batch
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
      return;
    }

    await updateDoc(ref, {
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

export async function deleteJournalCloud(
  chantierId: string,
  journalId: string
): Promise<void> {
  const cId = sanitizeDocId(chantierId);
  const jId = sanitizeDocId(journalId);
  try {
    await deleteDoc(doc(db, 'chantiers', cId, 'journaux', jId));
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
  userId: string,
  isAdmin: boolean
): Promise<Journal[]> {
  const col = collection(db, 'chantiers', chantier.id, 'journaux');
  let q = query(col);
  if (!isAdmin) {
    if (chantier.ownerId === userId) {
      q = query(col, where('chantierOwnerId', '==', userId));
    } else if ((chantier.visibility || 'team') === 'team') {
      q = query(col, where('chantierVisibility', '==', 'team'));
    } else {
      q = query(col, where('chantierMemberIds', 'array-contains', userId));
    }
  }
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
          active: typeof pub.active === 'boolean' ? pub.active : true,
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
      { ...ch, id: cId, visibility: ch.visibility || 'team' },
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
            visibility: cPayload.visibility,
            memberIds: cPayload.memberIds,
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
