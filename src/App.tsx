import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check, LogOut, PauseCircle, Shield, UserCircle2 } from 'lucide-react';
import { A4JournalSheet } from './components/A4JournalSheet';
import { AccessAdminView } from './components/AccessAdminView';
import {
  AccessGateScreen,
  type AccessGateState,
} from './components/AccessGateScreen';
import { AccountView } from './components/AccountView';
import { AppLogo } from './components/AppLogo';
import { AuthScreen } from './components/AuthScreen';
import { ChantierDetailView } from './components/ChantierDetailView';
import { ChantierModal } from './components/ChantierModal';
import { ChantiersView } from './components/ChantiersView';
import { ConfirmModal } from './components/ConfirmModal';
import { JournalEditorView } from './components/JournalEditorView';
import { JsonImportModal } from './components/JsonImportModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PdfProgressModal } from './components/PdfProgressModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ShareAccessModal } from './components/ShareAccessModal';
import { SignatureModal } from './components/SignatureModal';
import {
  StandbyResumeModal,
  type DraftStandbyOrJcPeriod,
} from './components/StandbyResumeModal';
import { Toast, type ToastState } from './components/Toast';
import { auth, isAdminEmail } from './firebase';
import {
  APP_SIGNATURE,
  STANDARD_TRAVAUX_PRESETS,
  type Chantier,
  type ChantierShare,
  type DB,
  type Journal,
  type UserProfile,
} from './types';
import {
  buildDailyFilename,
  buildWeeklyFilename,
  fmtDateFR,
  fmtDateJJMMAA,
  getChantierDisplayTitle,
  todayISO,
} from './utils/dates';
import {
  buildLocalDefaultProfile,
  checkDossierReaderStartup,
  checkUserAccessStartup,
  deleteChantierCloud,
  deleteJournalCloud,
  fetchChantierJournauxOnce,
  fetchChantiersAndSharesOnce,
  getCachedChantiersBundle,
  getCachedJournals,
  importLocalDbToCloud,
  redeemShareInvite,
  saveChantierCloud,
  saveJournalCloud,
  setCachedChantiersBundle,
  setCachedJournals,
  signJournalPageCloud,
} from './utils/firestoreService';
import { generateAndDeliverPdf, type PdfProgress } from './utils/pdfExport';
import {
  computeChantierJdtSummary,
  formatPeriodRecapLine,
} from './utils/jdtStatus';
import { exportShareableHTML } from './utils/shareHtml';
import {
  formatSignatureMethodLabel,
  signJournalPageWithSession,
  type VerifiedSigningSession,
} from './utils/signatureCrypto';
import {
  DEFAULT_DAY_FOLDER_KEY,
  DEFAULT_WEEK_FOLDER_KEY,
  downloadBlob,
  getLastBackupDate,
  loadDB,
  markBackupDone,
  uid,
} from './utils/storage';

type ViewMode = 'chantiers' | 'chantier' | 'journal' | 'compte' | 'acces';

function isGoogleAccount(u: User): boolean {
  return u.providerData.some((p) => p.providerId === 'google.com');
}

function isUserDelegateOnChantier(
  ch: Chantier | null | undefined,
  email?: string | null
): boolean {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!ch || !cleanEmail) return false;
  return (ch.delegateEmails || []).some(
    (e) => e.trim().toLowerCase() === cleanEmail
  );
}

function canAuthorOnChantier(
  ch: Chantier | null | undefined,
  u: User | null | undefined
): boolean {
  if (!ch || !u) return false;
  return ch.ownerId === u.uid || isUserDelegateOnChantier(ch, u.email);
}

function formatActionError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const low = err.message.toLowerCase();
    if (
      low.includes('quota') ||
      low.includes('réserv') ||
      low.includes('révoqu')
    ) {
      return err.message;
    }
    if (
      low.includes('permission-denied') ||
      low.includes('missing or insufficient permissions')
    ) {
      return `${fallback} (Accès Firestore refusé — vérifiez votre connexion ou les règles de sécurité.)`;
    }
    if (low.includes('offline') || low.includes('unavailable')) {
      return `${fallback} (Appareil hors-ligne ou serveur momentanément indisponible.)`;
    }
  }
  return fallback;
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [, setAuthTick] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accessState, setAccessState] = useState<
    'approved' | 'reader_only' | AccessGateState | null
  >(null);
  const [accessErrorMessage, setAccessErrorMessage] = useState<string | null>(
    null
  );

  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [shareByChantierId, setShareByChantierId] = useState<
    Record<string, ChantierShare>
  >({});
  const [chantiersLoaded, setChantiersLoaded] = useState(false);
  const [refreshingChantiers, setRefreshingChantiers] = useState(false);
  const [chantierJournals, setChantierJournals] = useState<Journal[]>([]);
  const [journalsByChantierId, setJournalsByChantierId] = useState<
    Record<string, Journal[]>
  >({});
  const [refreshingJournals, setRefreshingJournals] = useState(false);

  const [view, setView] = useState<ViewMode>('chantiers');
  const [currentChantierId, setCurrentChantierId] = useState<string | null>(
    null
  );
  const [currentJournalId, setCurrentJournalId] = useState<string | null>(
    null
  );
  const [editingJournalDraft, setEditingJournalDraft] =
    useState<Journal | null>(null);

  const [chantierModalOpen, setChantierModalOpen] = useState(false);
  const [editingChantier, setEditingChantier] = useState<Chantier | null>(null);
  const [shareAccessModalOpen, setShareAccessModalOpen] = useState(false);
  const [standbyModalState, setStandbyModalState] = useState<{
    chantier: Chantier;
    initialKind: 'standby' | 'jc';
  } | null>(null);

  // Single-verification signing session & modal state
  const [signingSession, setSigningSession] =
    useState<VerifiedSigningSession | null>(null);
  const [signModalState, setSignModalState] = useState<{
    role: 'controleur' | 'lecteur';
    targetLabel: string;
    targetJournals: Journal[];
  } | null>(null);

  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(
    () => {
      try {
        const param = new URLSearchParams(window.location.search).get('invite');
        return param ? param.trim().toUpperCase() : null;
      } catch {
        return null;
      }
    }
  );

  const [pendingChantierId, setPendingChantierId] = useState<string | null>(
    () => {
      try {
        const param = new URLSearchParams(window.location.search).get(
          'chantier'
        );
        if (param && param.trim()) {
          const clean = param.trim();
          localStorage.setItem('jt_pending_chantier_id', clean);
          return clean;
        }
        return localStorage.getItem('jt_pending_chantier_id') || null;
      } catch {
        return null;
      }
    }
  );
  const pendingChantierIdRef = useRef<string | null>(pendingChantierId);
  pendingChantierIdRef.current = pendingChantierId;
  const hasCloudChantiersSyncedRef = useRef(false);

  const updatePendingChantierId = useCallback((nextId: string | null) => {
    setPendingChantierId(nextId);
    try {
      if (nextId) {
        localStorage.setItem('jt_pending_chantier_id', nextId);
      } else {
        localStorage.removeItem('jt_pending_chantier_id');
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const [pendingJsonImport, setPendingJsonImport] = useState<DB | null>(null);
  const [lastBackupIso, setLastBackupIso] = useState<string | null>(() =>
    getLastBackupDate()
  );
  const [migratingLocal, setMigratingLocal] = useState(false);
  const [localMigrationDismissed, setLocalMigrationDismissed] = useState(false);

  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null);
  const [printPayload, setPrintPayload] = useState<{
    chantier: Chantier;
    journals: Journal[];
  } | null>(null);

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{
    journal: Journal;
    chantier: Chantier;
    user: User;
  } | null>(null);

  const isAdmin = isAdminEmail(user?.email);

  const notify = useCallback(
    (message: string, tone: 'default' | 'success' | 'error' = 'default') => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      setToast({ message, tone });
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 3400);
    },
    []
  );

  // Flush any debounced journal write immediately
  const flushPendingJournalSave = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (pending) {
      pendingSaveRef.current = null;
      try {
        await saveJournalCloud(pending.journal, pending.chantier, pending.user);
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('déjà été signée par un membre')
        ) {
          notify(err.message, 'error');
          try {
            const fresh = await fetchChantierJournauxOnce(
              pending.chantier,
              pending.user.uid,
              pending.user.email
            );
            setChantierJournals(fresh);
            const found = fresh.find((j) => j.id === pending.journal.id);
            if (found) setEditingJournalDraft(found);
          } catch {
            // ignore refresh failure
          }
          return;
        }
        throw err;
      }
    }
  }, [notify]);

  const evaluateUserAccess = useCallback(async (nextUser: User) => {
    const emailVerifiedOrGoogle =
      nextUser.emailVerified || isGoogleAccount(nextUser);
    if (!emailVerifiedOrGoogle) {
      setProfile(null);
      setAccessState(null);
      setAccessErrorMessage(null);
      return;
    }

    setProfile(buildLocalDefaultProfile(nextUser));

    // Sole Admin enters directly with 0 Firestore reads at startup
    if (isAdminEmail(nextUser.email)) {
      setAccessState('approved');
      setAccessErrorMessage(null);
      return;
    }

    // Colleague: 1 single getDocFromServer read at startup (with automatic dossier reader fallback)
    try {
      const res = await checkUserAccessStartup(nextUser);
      if (res.state === 'approved') {
        setAccessState('approved');
        setAccessErrorMessage(null);
        return;
      }
      if (res.state === 'revoked') {
        setAccessState('revoked');
        setAccessErrorMessage(null);
        return;
      }

      const hasDossierAccess = await checkDossierReaderStartup(
        nextUser,
        pendingChantierIdRef.current
      );
      if (hasDossierAccess) {
        setAccessState('reader_only');
        setAccessErrorMessage(null);
        return;
      }

      setAccessState(res.state);
      setAccessErrorMessage(
        res.state === 'quota_exceeded' ? res.errorMessage : null
      );
    } catch (err) {
      const hasCachedReader = await checkDossierReaderStartup(
        nextUser,
        pendingChantierIdRef.current
      ).catch(() => false);
      if (hasCachedReader) {
        setAccessState('reader_only');
        setAccessErrorMessage(null);
        return;
      }
      setAccessState('offline_unapproved');
      setAccessErrorMessage(
        err instanceof Error ? err.message : "Erreur lors de la vérification d'accès."
      );
    }
  }, []);

  // Auth listener (no onSnapshot anywhere)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setSigningSession(null);
      if (!nextUser) {
        setProfile(null);
        setAccessState(null);
        setAccessErrorMessage(null);
        setChantiers([]);
        setShareByChantierId({});
        setChantierJournals([]);
        setJournalsByChantierId({});
        setChantiersLoaded(false);
        setView('chantiers');
        setCurrentChantierId(null);
        setCurrentJournalId(null);
        setAuthReady(true);
        return;
      }

      await evaluateUserAccess(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, [evaluateUserAccess]);

  const hydrateAndFetchAllJournals = useCallback(
    async (list: Chantier[], targetUser: User) => {
      if (!list.length) {
        setJournalsByChantierId({});
        return;
      }
      const fromCache: Record<string, Journal[]> = {};
      for (const ch of list) {
        const cached = getCachedJournals(ch.id);
        if (cached) fromCache[ch.id] = cached;
      }
      if (Object.keys(fromCache).length > 0) {
        setJournalsByChantierId((prev) => ({ ...prev, ...fromCache }));
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;

      const results = await Promise.allSettled(
        list.map((ch) =>
          fetchChantierJournauxOnce(ch, targetUser.uid, targetUser.email).then(
            (journals) => ({ chantierId: ch.id, journals })
          )
        )
      );
      const nextMap: Record<string, Journal[]> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          nextMap[r.value.chantierId] = r.value.journals;
        }
      }
      if (Object.keys(nextMap).length > 0) {
        setJournalsByChantierId((prev) => ({ ...prev, ...nextMap }));
      }
    },
    []
  );

  const refreshChantiersFromCloud = useCallback(
    async (targetUser: User, silent = false) => {
      setRefreshingChantiers(true);
      try {
        const res = await fetchChantiersAndSharesOnce(
          targetUser.uid,
          targetUser.email
        );
        if (!res.fromCache) {
          hasCloudChantiersSyncedRef.current = true;
        }
        setChantiers(res.chantiers);
        setShareByChantierId(res.shareByChantierId);
        setChantiersLoaded(true);
        void hydrateAndFetchAllJournals(res.chantiers, targetUser);
        if (!silent) {
          notify(
            res.fromCache
              ? 'Affichage hors-ligne depuis le cache local.'
              : 'Liste des chantiers synchronisée.',
            res.fromCache ? 'default' : 'success'
          );
        }
      } catch (err) {
        if (!silent) {
          notify(
            formatActionError(
              err,
              'Erreur lors de la synchronisation des chantiers.'
            ),
            'error'
          );
        }
      } finally {
        setRefreshingChantiers(false);
      }
    },
    [notify, hydrateAndFetchAllJournals]
  );

  // Load Chantiers once approved: show local cache immediately, and sync latest version from cloud when online
  const lastSyncRef = useRef<number>(0);

  useEffect(() => {
    const isAuthorized = Boolean(
      user &&
        (user.emailVerified || isGoogleAccount(user)) &&
        (isAdmin || accessState === 'approved' || accessState === 'reader_only')
    );
    if (!isAuthorized || !user) {
      hasCloudChantiersSyncedRef.current = false;
      setChantiers([]);
      setShareByChantierId({});
      setChantierJournals([]);
      setJournalsByChantierId({});
      setChantiersLoaded(false);
      return;
    }

    const cached = getCachedChantiersBundle(user.uid);
    if (cached) {
      setChantiers(cached.chantiers);
      setShareByChantierId(cached.shareByChantierId);
      setChantiersLoaded(true);
      const cachedJournals: Record<string, Journal[]> = {};
      for (const ch of cached.chantiers) {
        const cj = getCachedJournals(ch.id);
        if (cj) cachedJournals[ch.id] = cj;
      }
      if (Object.keys(cachedJournals).length > 0) {
        setJournalsByChantierId(cachedJournals);
      }
    }

    // Always pull latest version from Firestore when online so any platform stays up-to-date
    if (typeof navigator === 'undefined' || navigator.onLine) {
      lastSyncRef.current = Date.now();
      void refreshChantiersFromCloud(user, true);
    }
  }, [user, isAdmin, accessState, refreshChantiersFromCloud]);

  // Flush unsaved edits when leaving tab/app and sync fresh cloud updates when returning online
  useEffect(() => {
    const isAuthorized = Boolean(
      user &&
        (user.emailVerified || isGoogleAccount(user)) &&
        (isAdmin || accessState === 'approved' || accessState === 'reader_only')
    );
    if (!isAuthorized || !user) return;

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingJournalSave();
        return;
      }
      if (
        document.visibilityState === 'visible' &&
        (typeof navigator === 'undefined' || navigator.onLine) &&
        Date.now() - lastSyncRef.current > 15000
      ) {
        lastSyncRef.current = Date.now();
        void refreshChantiersFromCloud(user, true);
        if (currentChantierId) {
          const ch = chantiers.find((c) => c.id === currentChantierId);
          if (ch) {
            void fetchChantierJournauxOnce(ch, user.uid, user.email)
              .then((list) => setChantierJournals(list))
              .catch(() => {});
          }
        }
      }
    };

    const handleOnline = () => {
      void flushPendingJournalSave().catch(() => {});
      if (Date.now() - lastSyncRef.current > 5000) {
        lastSyncRef.current = Date.now();
        void refreshChantiersFromCloud(user, true);
      }
    };

    const handlePageHide = () => {
      void flushPendingJournalSave();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [
    user,
    isAdmin,
    accessState,
    currentChantierId,
    chantiers,
    flushPendingJournalSave,
    refreshChantiersFromCloud,
  ]);

  // Redeem pending URL ?invite=CODE automatically once user is authorized & logged in
  useEffect(() => {
    if (
      !pendingInviteCode ||
      !user ||
      (!user.emailVerified && !isGoogleAccount(user)) ||
      (!isAdmin && accessState !== 'approved' && accessState !== 'reader_only')
    ) {
      return;
    }

    const code = pendingInviteCode;
    setPendingInviteCode(null);

    try {
      const cleanedUrl = new URL(window.location.href);
      cleanedUrl.searchParams.delete('invite');
      window.history.replaceState({}, '', cleanedUrl.toString());
    } catch {
      // ignore URL cleanup errors
    }

    void (async () => {
      try {
        const res = await redeemShareInvite(code, user);
        await refreshChantiersFromCloud(user, true);
        setCurrentChantierId(res.chantierId);
        setCurrentJournalId(null);
        setView('chantier');
        notify(
          `Accès temporaire activé pour « ${res.chantierProjet} ».`,
          'success'
        );
      } catch (err) {
        notify(
          err instanceof Error
            ? err.message
            : "Impossible d'activer ce code d'accès temporaire.",
          'error'
        );
      }
    })();
  }, [
    pendingInviteCode,
    user,
    accessState,
    isAdmin,
    notify,
    refreshChantiersFromCloud,
  ]);

  // Open pending URL ?chantier=ID automatically once chantiers are synced
  useEffect(() => {
    if (
      !pendingChantierId ||
      !user ||
      (!user.emailVerified && !isGoogleAccount(user)) ||
      (!isAdmin &&
        accessState !== 'approved' &&
        accessState !== 'reader_only') ||
      !chantiersLoaded
    ) {
      return;
    }

    const found = chantiers.find((c) => c.id === pendingChantierId);
    if (found) {
      updatePendingChantierId(null);
      try {
        const cleanedUrl = new URL(window.location.href);
        cleanedUrl.searchParams.delete('chantier');
        window.history.replaceState({}, '', cleanedUrl.toString());
      } catch {
        // ignore URL cleanup
      }
      setCurrentChantierId(found.id);
      setCurrentJournalId(null);
      setView('chantier');
      return;
    }

    if (hasCloudChantiersSyncedRef.current && !refreshingChantiers) {
      updatePendingChantierId(null);
      try {
        const cleanedUrl = new URL(window.location.href);
        cleanedUrl.searchParams.delete('chantier');
        window.history.replaceState({}, '', cleanedUrl.toString());
      } catch {
        // ignore URL cleanup
      }
      notify(
        `Ce dossier n'est pas partagé avec ${user.email || 'ce compte'}.`,
        'error'
      );
    }
  }, [
    pendingChantierId,
    user,
    isAdmin,
    accessState,
    chantiersLoaded,
    chantiers,
    refreshingChantiers,
    notify,
    updatePendingChantierId,
  ]);

  const currentChantier = useMemo(
    () => chantiers.find((c) => c.id === currentChantierId) || null,
    [chantiers, currentChantierId]
  );

  // If shared chantier expires or is revoked while open, return safely to Chantiers list
  useEffect(() => {
    if (
      chantiersLoaded &&
      currentChantierId &&
      !currentChantier &&
      (view === 'chantier' || view === 'journal')
    ) {
      setCurrentChantierId(null);
      setCurrentJournalId(null);
      setEditingJournalDraft(null);
      setView('chantiers');
      notify("L'accès à ce chantier a expiré ou a été révoqué.");
    }
  }, [chantiersLoaded, currentChantierId, currentChantier, view, notify]);

  const refreshJournalsFromCloud = useCallback(
    async (chantier: Chantier, targetUser: User, silent = false) => {
      setRefreshingJournals(true);
      try {
        const list = await fetchChantierJournauxOnce(
          chantier,
          targetUser.uid,
          targetUser.email
        );
        setChantierJournals(list);
        setJournalsByChantierId((prev) => ({ ...prev, [chantier.id]: list }));
        if (!silent) {
          notify('Journaux actualisés.', 'success');
        }
      } catch (err) {
        const cached = getCachedJournals(chantier.id);
        if (cached) {
          setChantierJournals(cached);
          setJournalsByChantierId((prev) => ({
            ...prev,
            [chantier.id]: cached,
          }));
        }
        if (!silent) {
          notify(
            formatActionError(
              err,
              'Erreur lors du chargement des journaux.'
            ),
            'error'
          );
        }
      } finally {
        setRefreshingJournals(false);
      }
    },
    [notify]
  );

  // Load selected Chantier's journals (cache-first + 1 on-demand fetch when opening chantier)
  useEffect(() => {
    if (
      !user ||
      (!user.emailVerified && !isGoogleAccount(user)) ||
      !currentChantier
    ) {
      setChantierJournals([]);
      return;
    }

    const cached = getCachedJournals(currentChantier.id);
    if (cached) {
      setChantierJournals(cached);
    }

    if (typeof navigator === 'undefined' || navigator.onLine) {
      void refreshJournalsFromCloud(currentChantier, user, true);
    }
  }, [user, currentChantier, refreshJournalsFromCloud]);

  // Keep editingJournalDraft synced when opening a journal
  useEffect(() => {
    if (view !== 'journal' || !currentJournalId) {
      setEditingJournalDraft(null);
      return;
    }
    if (!pendingSaveRef.current) {
      const found = chantierJournals.find((j) => j.id === currentJournalId);
      if (found) setEditingJournalDraft(found);
    }
  }, [view, currentJournalId, chantierJournals]);

  const currentJournal = useMemo(() => {
    if (editingJournalDraft && editingJournalDraft.id === currentJournalId) {
      return editingJournalDraft;
    }
    return chantierJournals.find((j) => j.id === currentJournalId) || null;
  }, [editingJournalDraft, chantierJournals, currentJournalId]);

  const previousJournal = useMemo(() => {
    if (!currentJournal) return null;
    const others = chantierJournals
      .filter((j) => j.id !== currentJournal.id)
      .sort(
        (a, b) =>
          (b.date || '').localeCompare(a.date || '') ||
          b.journalNum - a.journalNum
      );
    return others[0] || null;
  }, [chantierJournals, currentJournal]);

  const activeChantierTabs = useMemo(() => {
    const today = todayISO();
    const list = chantiers
      .filter((ch) => ch.jdtStatus !== 'archived')
      .map((ch) => ({
        chantier: ch,
        summary: computeChantierJdtSummary(
          ch,
          journalsByChantierId[ch.id] || [],
          today
        ),
      }));
    list.sort((a, b) => {
      const rank = (s: typeof a.summary) =>
        s.effectiveStatus === 'standby'
          ? 3
          : s.remainingToValidateCount > 0
            ? 0
            : s.hasOpenJdt
              ? 1
              : 2;
      const rA = rank(a.summary);
      const rB = rank(b.summary);
      if (rA !== rB) return rA - rB;
      if (
        rA === 0 &&
        b.summary.remainingToValidateCount !== a.summary.remainingToValidateCount
      ) {
        return (
          b.summary.remainingToValidateCount - a.summary.remainingToValidateCount
        );
      }
      return getChantierDisplayTitle(a.chantier).localeCompare(
        getChantierDisplayTitle(b.chantier)
      );
    });
    return list;
  }, [chantiers, journalsByChantierId]);

  const firmSuggestions = useMemo(() => {
    const set = new Set<string>();
    if (currentChantier?.entrepriseNom) set.add(currentChantier.entrepriseNom);
    chantiers.forEach((c) => {
      if (c.entrepriseNom) set.add(c.entrepriseNom);
    });
    chantierJournals.forEach((j) => {
      (j.ouvriers || []).forEach((o) => {
        if (o.firme?.trim()) set.add(o.firme.trim());
      });
    });
    return Array.from(set);
  }, [chantiers, chantierJournals, currentChantier]);

  const travauxSuggestions = useMemo(() => {
    const set = new Set<string>(STANDARD_TRAVAUX_PRESETS);
    if (currentChantier) {
      (currentChantier.postes || []).forEach((p) => {
        if (p?.trim()) set.add(p.trim());
      });
    }
    chantierJournals.forEach((j) => {
      (j.travaux || []).forEach((t) => {
        if (t?.trim()) set.add(t.trim());
      });
    });
    return Array.from(set);
  }, [chantierJournals, currentChantier]);

  // Check legacy localStorage data for optional migration
  const localDbSnapshot = useMemo(() => loadDB(), []);
  const unmigratedLocalCount = useMemo(() => {
    if (localMigrationDismissed || !localDbSnapshot.chantiers.length) return 0;
    const cloudIds = new Set(chantiers.map((c) => c.id));
    return localDbSnapshot.chantiers.filter((c) => !cloudIds.has(c.id)).length;
  }, [localDbSnapshot, chantiers, localMigrationDismissed]);

  const handleMigrateLocal = async () => {
    if (!user) return;
    setMigratingLocal(true);
    try {
      const existingIds = new Set(chantiers.map((c) => c.id));
      const res = await importLocalDbToCloud(localDbSnapshot, user, existingIds);
      setLocalMigrationDismissed(true);
      await refreshChantiersFromCloud(user, true);
      notify(
        `Synchronisé : ${res.importedChantiers} chantier(s) et ${res.importedJournaux} journal(aux).`,
        'success'
      );
    } catch (err) {
      notify(
        formatActionError(err, 'Erreur lors du transfert vers le cloud.'),
        'error'
      );
    } finally {
      setMigratingLocal(false);
    }
  };

  // Redeem invite code manually from ChantiersView
  const handleRedeemInvite = async (code: string) => {
    if (!user) return;
    try {
      const res = await redeemShareInvite(code, user);
      await refreshChantiersFromCloud(user, true);
      setCurrentChantierId(res.chantierId);
      setCurrentJournalId(null);
      setView('chantier');
      notify(
        `Accès temporaire activé pour « ${res.chantierProjet} ».`,
        'success'
      );
    } catch (err) {
      notify(
        err instanceof Error
          ? err.message
          : "Code d'accès temporaire invalide ou expiré.",
        'error'
      );
    }
  };

  // Chantier CRUD (keeps React state + localStorage cache synced)
  const handleSaveChantier = async (
    chantier: Chantier,
    options?: { keepOpen?: boolean }
  ): Promise<boolean> => {
    if (!user) return false;
    try {
      const saved = await saveChantierCloud(chantier, user);
      setChantiers((prev) => {
        const next = [...prev.filter((c) => c.id !== saved.id), saved].sort(
          (a, b) =>
            (a.numero || a.projet || '').localeCompare(
              b.numero || b.projet || ''
            )
        );
        setCachedChantiersBundle(user.uid, {
          chantiers: next,
          shareByChantierId,
        });
        return next;
      });
      if (options?.keepOpen) {
        setEditingChantier(saved);
      } else {
        setChantierModalOpen(false);
        setEditingChantier(null);
      }
      if (view === 'chantier' && currentChantierId === saved.id) {
        setCurrentChantierId(saved.id);
      }
      notify('Chantier enregistré dans le cloud.', 'success');
      return true;
    } catch (err) {
      notify(
        formatActionError(err, "Impossible d'enregistrer le chantier."),
        'error'
      );
      return false;
    }
  };

  const handleDeleteChantier = (ch: Chantier) => {
    if (!user) return;
    setConfirmState({
      title: 'Supprimer le chantier ?',
      message: `Supprimer « ${ch.numero || ''} ${ch.projet || ''} » ainsi que tous ses journaux ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await deleteChantierCloud(ch.id);
          setChantiers((prev) => {
            const next = prev.filter((item) => item.id !== ch.id);
            setCachedChantiersBundle(user.uid, {
              chantiers: next,
              shareByChantierId,
            });
            return next;
          });
          if (currentChantierId === ch.id) {
            setCurrentChantierId(null);
            setCurrentJournalId(null);
            setView('chantiers');
          }
          notify('Chantier supprimé.');
        } catch (err) {
          notify(
            formatActionError(err, 'Erreur lors de la suppression du chantier.'),
            'error'
          );
        }
      },
    });
  };

  // Journal CRUD
  const updateJournalsAndCache = useCallback(
    (chantierId: string, updater: (prev: Journal[]) => Journal[]) => {
      setJournalsByChantierId((prevMap) => {
        const base = prevMap[chantierId] || [];
        const next = updater(base).sort(
          (a, b) =>
            (a.date || '').localeCompare(b.date || '') ||
            a.journalNum - b.journalNum
        );
        setCachedJournals(chantierId, next);
        return { ...prevMap, [chantierId]: next };
      });
      if (currentChantierId === chantierId) {
        setChantierJournals((prev) => {
          const next = updater(prev).sort(
            (a, b) =>
              (a.date || '').localeCompare(b.date || '') ||
              a.journalNum - b.journalNum
          );
          setCachedJournals(chantierId, next);
          return next;
        });
      }
    },
    [currentChantierId]
  );

  const resolveDayPrepose = useCallback(
    (chantier: Chantier, targetUser: User): string => {
      if (chantier.ownerId === targetUser.uid) {
        return chantier.preposeSurveillance || profile?.defaultPrepose || '';
      }
      return (
        chantier.delegateName?.trim() ||
        profile?.displayName ||
        targetUser.displayName ||
        targetUser.email?.split('@')[0] ||
        ''
      );
    },
    [profile]
  );

  const buildBlankJournalForChantier = useCallback(
    (
      chantier: Chantier,
      targetUser: User,
      journalNum: number,
      date: string,
      prevJournal?: Journal | null,
      options?: {
        emptyOuvriers?: boolean;
        travaux?: string[];
        status?: 'in_progress' | 'completed';
        specialType?: 'standby' | 'jc' | '';
        periodStart?: string;
        periodEnd?: string;
      }
    ): Journal => ({
      id: uid(),
      chantierId: chantier.id,
      chantierOwnerId: chantier.ownerId || targetUser.uid,
      chantierReaderIds: chantier.readerIds || [],
      chantierReaderEmails: chantier.readerEmails || [],
      chantierDelegateEmails: chantier.delegateEmails || [],
      preposeSurveillance: resolveDayPrepose(chantier, targetUser),
      authorId: targetUser.uid,
      authorName:
        profile?.displayName ||
        targetUser.displayName ||
        targetUser.email?.split('@')[0] ||
        'Utilisateur',
      status: options?.status || 'in_progress',
      specialType: options?.specialType || '',
      periodStart: options?.periodStart || '',
      periodEnd: options?.periodEnd || '',
      journalNum,
      date,
      horaireDebut:
        chantier.horaireDebut || profile?.defaultHoraireDebut || '07:30',
      horaireFin: chantier.horaireFin || profile?.defaultHoraireFin || '16:30',
      tempMatin: '',
      tempApresMidi: '',
      etatAtmo: [],
      ouvriers: options?.emptyOuvriers
        ? []
        : [{ firme: chantier.entrepriseNom || '', metier: '', nbre: 1 }],
      travaux:
        options?.travaux !== undefined
          ? options.travaux
          : prevJournal
            ? [...(prevJournal.travaux || []).filter((x) => x.trim())]
            : [],
      materiel: [],
      materiaux: [],
      essais: [],
      evenements: [],
      decisions: [],
      visites: [],
      sigEntrepreneur: prevJournal?.sigEntrepreneur || '',
      signatureControleur: null,
      signatureLecteur: null,
    }),
    [profile, resolveDayPrepose]
  );

  const handleOpenTodayJournal = async (ch: Chantier) => {
    if (!user) return;
    await flushPendingJournalSave();
    setCurrentChantierId(ch.id);

    let list = journalsByChantierId[ch.id] || getCachedJournals(ch.id) || [];
    if (!list.length && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        list = await fetchChantierJournauxOnce(ch, user.uid, user.email);
      } catch {
        // keep cached empty
      }
    }

    const today = todayISO();
    const sortedAsc = [...list].sort(
      (a, b) =>
        (a.date || '').localeCompare(b.date || '') ||
        a.journalNum - b.journalNum
    );
    const todayMatches = sortedAsc.filter((j) => j.date === today);
    if (todayMatches.length > 0) {
      const target = todayMatches[todayMatches.length - 1];
      setChantierJournals(sortedAsc);
      setEditingJournalDraft(target);
      setCurrentJournalId(target.id);
      setView('journal');
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      return;
    }

    if (!canAuthorOnChantier(ch, user) || ch.jdtStatus === 'archived') {
      setChantierJournals(sortedAsc);
      setView('chantier');
      return;
    }

    const maxNum = sortedAsc.reduce((m, j) => Math.max(m, j.journalNum || 0), 0);
    const prevJournal = sortedAsc.length > 0 ? sortedAsc[sortedAsc.length - 1] : null;
    const newJ = buildBlankJournalForChantier(ch, user, maxNum + 1, today, prevJournal);

    try {
      await saveJournalCloud(newJ, ch, user);
      const nextList = [...sortedAsc, newJ];
      setChantierJournals(nextList);
      setJournalsByChantierId((prev) => ({ ...prev, [ch.id]: nextList }));
      setCachedJournals(ch.id, nextList);
      setEditingJournalDraft(newJ);
      setCurrentJournalId(newJ.id);
      setView('journal');
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } catch (err) {
      notify(formatActionError(err, 'Impossible de créer le journal du jour.'), 'error');
    }
  };

  const updateChantierInState = useCallback(
    (saved: Chantier) => {
      if (!user) return;
      setChantiers((prev) => {
        const next = [...prev.filter((c) => c.id !== saved.id), saved].sort(
          (a, b) =>
            (a.numero || a.projet || '').localeCompare(
              b.numero || b.projet || ''
            )
        );
        setCachedChantiersBundle(user.uid, {
          chantiers: next,
          shareByChantierId,
        });
        return next;
      });
    },
    [user, shareByChantierId]
  );

  const handlePutChantierStandby = async (ch: Chantier) => {
    if (!user || ch.ownerId !== user.uid) return;
    try {
      const saved = await saveChantierCloud(
        {
          ...ch,
          jdtStatus: 'standby',
          standbySince: todayISO(),
        },
        user
      );
      updateChantierInState(saved);
      notify(
        `Chantier « ${getChantierDisplayTitle(saved)} » mis en stand-by (staté).`,
        'success'
      );
    } catch (err) {
      notify(
        formatActionError(err, 'Impossible de mettre le chantier en stand-by.'),
        'error'
      );
    }
  };

  const handleCancelStandby = async (ch: Chantier) => {
    if (!user || ch.ownerId !== user.uid) return;
    try {
      const saved = await saveChantierCloud(
        {
          ...ch,
          jdtStatus: 'active',
          standbySince: '',
        },
        user
      );
      updateChantierInState(saved);
      setStandbyModalState(null);
      notify(
        `Statage annulé pour « ${getChantierDisplayTitle(saved)} » : retour à l’état actif sans période enregistrée.`,
        'success'
      );
    } catch (err) {
      notify(
        formatActionError(err, 'Impossible d’annuler le statage.'),
        'error'
      );
      throw err;
    }
  };

  const handleConfirmStandbyResume = async (
    ch: Chantier,
    params: {
      periods: DraftStandbyOrJcPeriod[];
      resumeDate: string;
      openResumeJournal: boolean;
    }
  ) => {
    if (!user || ch.ownerId !== user.uid) return;
    await flushPendingJournalSave();

    let list = journalsByChantierId[ch.id] || getCachedJournals(ch.id) || [];
    if (typeof navigator === 'undefined' || navigator.onLine) {
      try {
        list = await fetchChantierJournauxOnce(ch, user.uid, user.email);
      } catch {
        // fallback to existing list
      }
    }

    const working = [...list].sort(
      (a, b) =>
        (a.date || '').localeCompare(b.date || '') ||
        a.journalNum - b.journalNum
    );
    let maxNum = working.reduce((m, j) => Math.max(m, j.journalNum || 0), 0);
    const latestPrev =
      working.length > 0 ? working[working.length - 1] : null;

    const sortedPeriods = [...params.periods].sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );

    for (const period of sortedPeriods) {
      const line = formatPeriodRecapLine(
        period.startDate,
        period.endDate,
        period.kind,
        period.note
      );
      const existingUnsigned = working.find(
        (j) =>
          j.date === period.startDate &&
          !j.signatureControleur &&
          !j.signatureLecteur
      );

      if (existingUnsigned) {
        const cleanTravaux = (existingUnsigned.travaux || [])
          .map((t) => t.trim())
          .filter(Boolean);
        const alreadyHasLine = cleanTravaux.some((t) => t === line);
        const updatedJournal: Journal = {
          ...existingUnsigned,
          status: 'completed',
          specialType: period.kind,
          periodStart: period.startDate,
          periodEnd: period.endDate,
          ouvriers: cleanTravaux.length === 0 ? [] : existingUnsigned.ouvriers,
          travaux: alreadyHasLine ? cleanTravaux : [...cleanTravaux, line],
        };
        try {
          await saveJournalCloud(updatedJournal, ch, user);
          const idx = working.findIndex((j) => j.id === existingUnsigned.id);
          if (idx >= 0) working[idx] = updatedJournal;
        } catch (err) {
          if (
            err instanceof Error &&
            err.message.includes('déjà été signée par un membre')
          ) {
            maxNum += 1;
            const periodJournal = buildBlankJournalForChantier(
              ch,
              user,
              maxNum,
              period.startDate,
              latestPrev,
              {
                emptyOuvriers: true,
                travaux: [line],
                status: 'completed',
                specialType: period.kind,
                periodStart: period.startDate,
                periodEnd: period.endDate,
              }
            );
            await saveJournalCloud(periodJournal, ch, user);
            working.push(periodJournal);
          } else {
            throw err;
          }
        }
      } else {
        maxNum += 1;
        const periodJournal = buildBlankJournalForChantier(
          ch,
          user,
          maxNum,
          period.startDate,
          latestPrev,
          {
            emptyOuvriers: true,
            travaux: [line],
            status: 'completed',
            specialType: period.kind,
            periodStart: period.startDate,
            periodEnd: period.endDate,
          }
        );
        await saveJournalCloud(periodJournal, ch, user);
        working.push(periodJournal);
      }
    }

    const shouldCreateResume =
      params.openResumeJournal || ch.jdtStatus === 'standby';
    let resumeJournal: Journal | null = null;
    if (shouldCreateResume && params.resumeDate) {
      resumeJournal =
        working.find((j) => j.date === params.resumeDate) || null;
      if (!resumeJournal) {
        maxNum += 1;
        resumeJournal = buildBlankJournalForChantier(
          ch,
          user,
          maxNum,
          params.resumeDate,
          latestPrev,
          {
            emptyOuvriers: false,
            travaux: [],
            status: 'in_progress',
          }
        );
        await saveJournalCloud(resumeJournal, ch, user);
        working.push(resumeJournal);
      }
    }

    const updatedPeriods = [
      ...(ch.standbyPeriods || []),
      ...sortedPeriods.map((p) => ({
        id: p.id,
        kind: p.kind,
        startDate: p.startDate,
        endDate: p.endDate,
        resumeDate: shouldCreateResume ? params.resumeDate : '',
        note: p.note.trim() || undefined,
      })),
    ];

    const savedChantier = await saveChantierCloud(
      {
        ...ch,
        jdtStatus: 'active',
        standbySince: '',
        closedAt: '',
        standbyPeriods: updatedPeriods,
      },
      user
    );

    const finalSorted = working.sort(
      (a, b) =>
        (a.date || '').localeCompare(b.date || '') ||
        a.journalNum - b.journalNum
    );
    updateChantierInState(savedChantier);
    setJournalsByChantierId((prev) => ({ ...prev, [ch.id]: finalSorted }));
    setCachedJournals(ch.id, finalSorted);
    if (currentChantierId === ch.id) {
      setChantierJournals(finalSorted);
    }

    setStandbyModalState(null);
    const hasJcOnly = sortedPeriods.every((p) => p.kind === 'jc');
    if (hasJcOnly && !resumeJournal) {
      notify(
        `Congé Entreprise (JC) enregistré en 1 page récapitulative (${fmtDateJJMMAA(sortedPeriods[0]?.startDate)}).`,
        'success'
      );
    } else if (resumeJournal) {
      notify(
        `${hasJcOnly ? 'Congés (JC)' : 'Statage'} enregistré en 1 page · reprise au ${fmtDateJJMMAA(params.resumeDate)}.`,
        'success'
      );
    } else {
      notify('Période enregistrée en 1 page récapitulative.', 'success');
    }

    if (params.openResumeJournal && resumeJournal) {
      setCurrentChantierId(ch.id);
      setChantierJournals(finalSorted);
      setEditingJournalDraft(resumeJournal);
      setCurrentJournalId(resumeJournal.id);
      setView('journal');
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  };

  const handleArchiveChantier = (ch: Chantier) => {
    if (!user || ch.ownerId !== user.uid) return;
    setConfirmState({
      title: 'Clôturer ce JDT et archiver ?',
      message: `Le chantier « ${ch.numero || ''} ${ch.projet || ''} » sera classé dans le dossier Archives et le décompte des jours sera arrêté.`,
      confirmLabel: 'Clôturer et archiver',
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const saved = await saveChantierCloud(
            {
              ...ch,
              jdtStatus: 'archived',
              standbySince: '',
              closedAt: todayISO(),
            },
            user
          );
          updateChantierInState(saved);
          notify('JDT clôturé et classé dans le dossier Archives.', 'success');
        } catch (err) {
          notify(
            formatActionError(err, 'Impossible de clôturer ce chantier.'),
            'error'
          );
        }
      },
    });
  };

  const handleReopenChantier = async (ch: Chantier) => {
    if (!user || ch.ownerId !== user.uid) return;
    try {
      const saved = await saveChantierCloud(
        {
          ...ch,
          jdtStatus: 'active',
          closedAt: '',
        },
        user
      );
      updateChantierInState(saved);
      notify('Suivi du JDT réouvert dans les chantiers en cours.', 'success');
    } catch (err) {
      notify(
        formatActionError(err, 'Impossible de réouvrir ce chantier.'),
        'error'
      );
    }
  };

  const handleNewJournal = async () => {
    if (!currentChantier || !user) return;
    if (!canAuthorOnChantier(currentChantier, user)) return;

    const sorted = [...chantierJournals].sort(
      (a, b) =>
        (b.date || '').localeCompare(a.date || '') ||
        b.journalNum - a.journalNum
    );
    const maxNum = sorted.reduce((m, j) => Math.max(m, j.journalNum || 0), 0);
    const prevJournal = sorted[0];

    const newJ = buildBlankJournalForChantier(
      currentChantier,
      user,
      maxNum + 1,
      todayISO(),
      prevJournal
    );

    try {
      await saveJournalCloud(newJ, currentChantier, user);
      updateJournalsAndCache(currentChantier.id, (prev) => [...prev, newJ]);
      setEditingJournalDraft(newJ);
      setCurrentJournalId(newJ.id);
      setView('journal');
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } catch (err) {
      notify(formatActionError(err, 'Impossible de créer le journal.'), 'error');
    }
  };

  const handleDuplicateJournal = async (source: Journal) => {
    if (!currentChantier || !user) return;
    if (!canAuthorOnChantier(currentChantier, user)) return;

    const maxNum = chantierJournals.reduce(
      (m, j) => Math.max(m, j.journalNum || 0),
      0
    );

    const copy: Journal = {
      ...source,
      id: uid(),
      chantierOwnerId: currentChantier.ownerId || user.uid,
      chantierReaderIds: currentChantier.readerIds || [],
      chantierReaderEmails: currentChantier.readerEmails || [],
      chantierDelegateEmails: currentChantier.delegateEmails || [],
      preposeSurveillance: resolveDayPrepose(currentChantier, user),
      authorId: user.uid,
      authorName:
        profile?.displayName ||
        user.displayName ||
        user.email?.split('@')[0] ||
        'Utilisateur',
      status: 'in_progress',
      specialType: '',
      periodStart: '',
      periodEnd: '',
      journalNum: maxNum + 1,
      date: todayISO(),
      ouvriers: source.ouvriers.map((o) => ({ ...o })),
      etatAtmo: [...source.etatAtmo],
      travaux: [...source.travaux],
      materiel: [...source.materiel],
      materiaux: [...source.materiaux],
      essais: [...source.essais],
      evenements: [...source.evenements],
      decisions: [...source.decisions],
      visites: [...source.visites],
      signatureControleur: null,
      signatureLecteur: null,
    };

    try {
      await saveJournalCloud(copy, currentChantier, user);
      updateJournalsAndCache(currentChantier.id, (prev) => [...prev, copy]);
      setEditingJournalDraft(copy);
      setCurrentJournalId(copy.id);
      setView('journal');
      notify(
        `Journal N° ${copy.journalNum} créé depuis le N° ${source.journalNum}.`,
        'success'
      );
    } catch (err) {
      notify(
        formatActionError(err, 'Impossible de dupliquer le journal.'),
        'error'
      );
    }
  };

  const handleDeleteJournal = (j: Journal) => {
    if (!currentChantier) return;
    setConfirmState({
      title: `Supprimer le Journal N° ${j.journalNum} ?`,
      message: `Voulez-vous vraiment supprimer le journal du ${fmtDateFR(j.date)} ?`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await deleteJournalCloud(currentChantier.id, j.id);
          updateJournalsAndCache(currentChantier.id, (prev) =>
            prev.filter((item) => item.id !== j.id)
          );
          if (currentJournalId === j.id) {
            setCurrentJournalId(null);
            setEditingJournalDraft(null);
            setView('chantier');
          }
          notify('Journal supprimé.');
        } catch (err) {
          notify(
            formatActionError(
              err,
              'Permission refusée ou erreur lors de la suppression.'
            ),
            'error'
          );
        }
      },
    });
  };

  const handleUpdateJournal = (updated: Journal) => {
    if (!currentChantier || !user) return;
    const isOwner = currentChantier.ownerId === user.uid;
    const isDelegate = !isOwner && isUserDelegateOnChantier(currentChantier, user.email);
    if (!isOwner && !isDelegate) return;
    if (isDelegate && updated.status === 'completed') return;
    if (updated.signatureControleur || updated.signatureLecteur) return;

    const prepared: Journal = isDelegate
      ? {
          ...updated,
          authorId: user.uid,
          authorName:
            profile?.displayName ||
            user.displayName ||
            user.email?.split('@')[0] ||
            updated.authorName ||
            'Rédacteur',
          preposeSurveillance:
            updated.preposeSurveillance ||
            resolveDayPrepose(currentChantier, user),
        }
      : updated;

    setEditingJournalDraft(prepared);
    updateJournalsAndCache(currentChantier.id, (prev) =>
      prev.map((item) => (item.id === prepared.id ? prepared : item))
    );
    pendingSaveRef.current = {
      journal: prepared,
      chantier: currentChantier,
      user,
    };
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void flushPendingJournalSave().catch(() => {});
    }, 350);
  };

  const handleToggleJournalStatus = async (
    nextStatus: 'in_progress' | 'completed'
  ) => {
    if (!currentChantier || !currentJournal || !user) return;
    const isOwner = currentChantier.ownerId === user.uid;
    const isDelegate = !isOwner && isUserDelegateOnChantier(currentChantier, user.email);
    if (!isOwner && !isDelegate) return;
    if (isDelegate && (currentJournal.status === 'completed' || nextStatus !== 'completed')) {
      return;
    }
    if (currentJournal.signatureControleur || currentJournal.signatureLecteur) {
      return;
    }

    const previousJournalState = currentJournal;
    const updated: Journal = {
      ...currentJournal,
      status: nextStatus,
      ...(isDelegate
        ? {
            authorId: user.uid,
            authorName:
              profile?.displayName ||
              user.displayName ||
              user.email?.split('@')[0] ||
              currentJournal.authorName ||
              'Rédacteur',
            preposeSurveillance:
              currentJournal.preposeSurveillance ||
              resolveDayPrepose(currentChantier, user),
          }
        : {}),
    };
    setEditingJournalDraft(updated);
    pendingSaveRef.current = null;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    try {
      await saveJournalCloud(updated, currentChantier, user);
      updateJournalsAndCache(currentChantier.id, (prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      notify(
        nextStatus === 'completed'
          ? `Page du ${fmtDateJJMMAA(updated.date)} marquée comme terminée.`
          : `Page du ${fmtDateJJMMAA(updated.date)} repassée en cours.`,
        'success'
      );
    } catch (err) {
      setEditingJournalDraft(previousJournalState);
      if (
        err instanceof Error &&
        err.message.includes('déjà été signée par un membre')
      ) {
        notify(err.message, 'error');
        void refreshJournalsFromCloud(currentChantier, user, true);
        return;
      }
      notify(
        formatActionError(
          err,
          'Impossible de mettre à jour le statut de la page.'
        ),
        'error'
      );
    }
  };

  // Single-verification signing engine (hardware eID or verified session -> 1 signature per page)
  const executeSignJournals = useCallback(
    async (
      session: VerifiedSigningSession,
      role: 'controleur' | 'lecteur',
      journalsToSign: Journal[],
      onProgress?: (current: number, total: number, journal: Journal) => void
    ) => {
      if (!currentChantier) return;
      await flushPendingJournalSave();

      const isOwner = currentChantier.ownerId === user?.uid;

      for (let i = 0; i < journalsToSign.length; i += 1) {
        const j = journalsToSign[i];
        if (j.status !== 'completed') {
          throw new Error(
            `Le Journal N° ${j.journalNum} doit d'abord être marqué comme terminé.`
          );
        }
        onProgress?.(i + 1, journalsToSign.length, j);

        const effectiveJournal: Journal =
          role === 'controleur' && !isOwner
            ? {
                ...j,
                preposeSurveillance: session.signerName || j.preposeSurveillance,
              }
            : j;

        const sigRecord = await signJournalPageWithSession(
          session,
          role,
          currentChantier,
          effectiveJournal
        );
        await signJournalPageCloud(
          currentChantier.id,
          effectiveJournal.id,
          role,
          sigRecord,
          currentChantier,
          effectiveJournal,
          user
        );

        updateJournalsAndCache(currentChantier.id, (prev) =>
          prev.map((item) =>
            item.id !== effectiveJournal.id
              ? item
              : role === 'controleur'
                ? {
                    ...effectiveJournal,
                    signatureControleur: sigRecord,
                  }
                : { ...effectiveJournal, signatureLecteur: sigRecord }
          )
        );

        setEditingJournalDraft((prev) => {
          if (!prev || prev.id !== effectiveJournal.id) return prev;
          return role === 'controleur'
            ? { ...effectiveJournal, signatureControleur: sigRecord }
            : { ...effectiveJournal, signatureLecteur: sigRecord };
        });
      }

      notify(
        `${journalsToSign.length} page${journalsToSign.length > 1 ? 's' : ''} signée${journalsToSign.length > 1 ? 's' : ''} (${formatSignatureMethodLabel(session.method, session.hardwareVerified)}).`,
        'success'
      );
    },
    [
      currentChantier,
      flushPendingJournalSave,
      notify,
      updateJournalsAndCache,
      user,
    ]
  );

  const handleRequestSignJournals = async (
    journalsToSign: Journal[],
    role: 'controleur' | 'lecteur',
    targetLabel: string
  ) => {
    if (!user || !journalsToSign.length) return;
    const unsigned = journalsToSign.filter((j) =>
      role === 'controleur' ? !j.signatureControleur : !j.signatureLecteur
    );
    if (!unsigned.length) {
      notify('Toutes ces pages sont déjà signées pour votre rôle.');
      return;
    }

    if (
      signingSession &&
      signingSession.signerUid === user.uid &&
      signingSession.mode === 'account_fallback'
    ) {
      try {
        await executeSignJournals(signingSession, role, unsigned);
      } catch (err) {
        notify(
          err instanceof Error
            ? err.message
            : 'Erreur lors de la signature de la page.',
          'error'
        );
      }
      return;
    }

    setSignModalState({
      role,
      targetLabel,
      targetJournals: unsigned,
    });
  };

  // Print helper
  const triggerPrint = async (chantier: Chantier, journals: Journal[]) => {
    if (!journals.length) return;
    await flushPendingJournalSave();
    flushSync(() => {
      setPrintPayload({ chantier, journals });
    });
    document.body.classList.add('printing-active');

    const cleanup = () => {
      document.body.classList.remove('printing-active');
      setPrintPayload(null);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1200);
    }, 60);
  };

  // Daily PDF export (owner only)
  const handleExportDayPdf = async () => {
    if (!currentChantier || !currentJournal) return;
    await flushPendingJournalSave();
    const filename = buildDailyFilename(currentChantier, currentJournal);
    try {
      setPdfProgress({
        current: 0,
        total: 1,
        label: 'Préparation de la feuille A4…',
      });
      const res = await generateAndDeliverPdf(
        currentChantier,
        [currentJournal],
        filename,
        `dayFolder_${currentChantier.id}`,
        setPdfProgress,
        DEFAULT_DAY_FOLDER_KEY
      );
      setPdfProgress(null);
      notify(
        res.mode === 'folder'
          ? `${filename} enregistré dans « ${res.folderName} »`
          : `${filename} téléchargé`,
        'success'
      );
    } catch (err) {
      setPdfProgress(null);
      notify(
        err instanceof Error
          ? `Erreur PDF : ${err.message}`
          : 'Erreur lors de la génération du PDF.',
        'error'
      );
    }
  };

  // Gated Weekly PDF export (both Controller and Temp Reader once ALL pages of finished week are signed by both)
  const handleExportWeekPdf = async (weekJournals: Journal[]) => {
    if (!currentChantier || !weekJournals.length) return;
    const allCompleted = weekJournals.every((j) => j.status === 'completed');
    const allSignedBoth = weekJournals.every(
      (j) => Boolean(j.signatureControleur) && Boolean(j.signatureLecteur)
    );
    if (!allCompleted || !allSignedBoth) {
      notify(
        'Le PDF hebdomadaire est débloqué uniquement lorsque toutes les pages de la semaine terminée sont signées par le contrôleur et le lecteur.',
        'error'
      );
      return;
    }

    const sorted = [...weekJournals].sort(
      (a, b) =>
        (a.date || '').localeCompare(b.date || '') ||
        a.journalNum - b.journalNum
    );
    const filename = buildWeeklyFilename(currentChantier, sorted);
    try {
      setPdfProgress({
        current: 0,
        total: sorted.length,
        label: 'Préparation du PDF signé (métadonnées incluses)…',
      });
      const res = await generateAndDeliverPdf(
        currentChantier,
        sorted,
        filename,
        `weekFolder_${currentChantier.id}`,
        setPdfProgress,
        DEFAULT_WEEK_FOLDER_KEY
      );
      setPdfProgress(null);
      notify(
        res.mode === 'folder'
          ? `${filename} (${sorted.length} pages + signatures) enregistré dans « ${res.folderName} »`
          : `${filename} (${sorted.length} pages + signatures) téléchargé`,
        'success'
      );
    } catch (err) {
      setPdfProgress(null);
      notify(
        err instanceof Error
          ? `Erreur PDF : ${err.message}`
          : 'Erreur lors de la génération du PDF hebdomadaire.',
        'error'
      );
    }
  };

  // Full Cloud JSON Export / Import (owned dossiers only)
  const handleExportJson = async () => {
    if (!user) return;
    const myChantiers = chantiers.filter((c) => c.ownerId === user.uid);
    try {
      const allJournals: Journal[] = [];
      for (const ch of myChantiers) {
        const list = await fetchChantierJournauxOnce(ch, user.uid, user.email);
        allJournals.push(...list);
      }
      const payload: DB = { chantiers: myChantiers, journaux: allJournals };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const filename = `journal-travaux-backup-${todayISO()}.json`;
      downloadBlob(blob, filename);
      setLastBackupIso(markBackupDone());
      notify(
        `Archive exportée (${myChantiers.length} chantier(s), ${allJournals.length} journal(aux)).`,
        'success'
      );
    } catch (err) {
      notify(formatActionError(err, "Erreur lors de l'export JSON."), 'error');
    }
  };

  const handleImportJsonFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<DB>;
      if (!Array.isArray(parsed.chantiers) || !Array.isArray(parsed.journaux)) {
        throw new Error('Format JSON invalide.');
      }
      setPendingJsonImport({
        chantiers: parsed.chantiers,
        journaux: parsed.journaux,
      });
    } catch {
      notify('Fichier JSON invalide ou illisible.', 'error');
    }
  };

  const applyJsonImport = async (replaceAll: boolean) => {
    if (!pendingJsonImport || !user) return;
    const data = pendingJsonImport;
    setPendingJsonImport(null);

    try {
      if (replaceAll) {
        for (const ch of chantiers) {
          if (ch.ownerId === user.uid) {
            await deleteChantierCloud(ch.id);
          }
        }
      }
      const existingIds = replaceAll
        ? new Set<string>()
        : new Set(chantiers.map((c) => c.id));
      const res = await importLocalDbToCloud(data, user, existingIds);
      await refreshChantiersFromCloud(user, true);
      setCurrentChantierId(null);
      setCurrentJournalId(null);
      setView('chantiers');
      notify(
        `Import terminé : ${res.importedChantiers} chantier(s) et ${res.importedJournaux} journal(aux).`,
        'success'
      );
    } catch (err) {
      notify(
        formatActionError(err, "Erreur lors de l'importation vers le cloud."),
        'error'
      );
    }
  };

  // Auth loading state
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <div className="text-sm font-semibold text-slate-500">
          Chargement de la session…
        </div>
      </div>
    );
  }

  // Gate 1: Not signed in or corporate email unverified
  const isVerifiedOrGoogle = Boolean(
    user && (user.emailVerified || isGoogleAccount(user))
  );
  if (!user || !isVerifiedOrGoogle) {
    return (
      <AuthScreen
        unverifiedUser={user && !isVerifiedOrGoogle ? user : null}
        pendingChantierId={pendingChantierId}
        onVerifiedRefresh={async () => {
          if (!auth.currentUser) return false;
          await auth.currentUser.reload();
          if (auth.currentUser.emailVerified || isGoogleAccount(auth.currentUser)) {
            await auth.currentUser.getIdToken(true);
            setUser(auth.currentUser);
            setAuthTick((t) => t + 1);
            await evaluateUserAccess(auth.currentUser);
            return true;
          }
          setUser(auth.currentUser);
          setAuthTick((t) => t + 1);
          return false;
        }}
      />
    );
  }

  // Gate 2: Colleague waiting for personal code / admin approval / revoked / offline / quota
  if (!isAdmin && accessState !== 'approved' && accessState !== 'reader_only') {
    if (!accessState) {
      return (
        <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
          <div className="text-sm font-semibold text-slate-500">
            Vérification de votre accès…
          </div>
        </div>
      );
    }

    return (
      <>
        <AccessGateScreen
          user={user}
          gateState={accessState}
          errorMessage={accessErrorMessage}
          pendingInviteCode={pendingInviteCode}
          pendingChantierId={pendingChantierId}
          onActivated={() => {
            setAccessState('approved');
            setAccessErrorMessage(null);
          }}
          onDossierReaderActivated={(chantierId) => {
            updatePendingChantierId(chantierId);
            setAccessState('reader_only');
            setAccessErrorMessage(null);
          }}
          onPendingCreated={() => {
            setAccessState('pending');
          }}
          onRetryCheck={async () => {
            await evaluateUserAccess(user);
          }}
          onNotify={notify}
        />
        <Toast toast={toast} />
      </>
    );
  }

  const isColleagueOrAdmin = isAdmin || accessState === 'approved';

  const effectiveProfile: UserProfile =
    profile || buildLocalDefaultProfile(user);

  return (
    <>
      <div id="app-shell" className="min-h-screen flex flex-col bg-[#f4f6f9]">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-[#0a5b9c] text-white border-b border-[#063f6e] shadow-xs">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={async () => {
                await flushPendingJournalSave();
                setView('chantiers');
                setCurrentJournalId(null);
              }}
              className="flex items-center gap-3 text-left cursor-pointer group min-w-0"
            >
              <AppLogo className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl shrink-0 shadow-xs" />
              <div className="min-w-0">
                <div className="text-sm sm:text-base font-extrabold tracking-tight leading-tight truncate">
                  Mes JDT
                </div>
                <div className="text-[11px] text-white/75 truncate">
                  Journal des travaux · INASEP
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <PWAInstallButton variant="header" />
              <button
                type="button"
                onClick={async () => {
                  await flushPendingJournalSave();
                  setView('chantiers');
                  setCurrentJournalId(null);
                }}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  view !== 'compte' && view !== 'acces'
                    ? 'bg-white text-[#0a5b9c]'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                Chantiers
              </button>

              {isAdmin && (
                <button
                  type="button"
                  onClick={async () => {
                    await flushPendingJournalSave();
                    setView('acces');
                    window.scrollTo({
                      top: 0,
                      behavior: 'instant' as ScrollBehavior,
                    });
                  }}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    view === 'acces'
                      ? 'bg-white text-[#0a5b9c]'
                      : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                  title="Gérer les accès et codes personnels des collègues"
                >
                  <Shield className="w-4 h-4 shrink-0" />
                  <span>Accès</span>
                </button>
              )}

              <button
                type="button"
                onClick={async () => {
                  await flushPendingJournalSave();
                  setView('compte');
                  window.scrollTo({
                    top: 0,
                    behavior: 'instant' as ScrollBehavior,
                  });
                }}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                  view === 'compte'
                    ? 'bg-white text-[#0a5b9c]'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
                title="Mon compte, mot de passe et préférences"
              >
                <UserCircle2 className="w-4 h-4 shrink-0" />
                <span>Compte</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  await flushPendingJournalSave();
                  await signOut(auth);
                }}
                className="min-h-[38px] min-w-[38px] px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer"
                title="Se déconnecter"
                aria-label="Se déconnecter"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden lg:inline">Déconnexion</span>
              </button>
            </div>
          </div>

          {/* Persistent Top Tabs Bar for All Active Chantiers */}
          {activeChantierTabs.length > 0 && (
            <div className="bg-[#063f6e]/70 border-t border-white/10">
              <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {activeChantierTabs.map(({ chantier: tabCh, summary: tabSummary }) => {
                  const isActiveTab =
                    currentChantierId === tabCh.id &&
                    (view === 'chantier' || view === 'journal');
                  const tabTitle = getChantierDisplayTitle(tabCh);
                  const isStandby = tabSummary.effectiveStatus === 'standby';

                  return (
                    <button
                      key={tabCh.id}
                      type="button"
                      onClick={async () => {
                        await flushPendingJournalSave();
                        setCurrentChantierId(tabCh.id);
                        setCurrentJournalId(null);
                        setView('chantier');
                        window.scrollTo({
                          top: 0,
                          behavior: 'instant' as ScrollBehavior,
                        });
                      }}
                      title={`${tabCh.numero ? `${tabCh.numero} — ` : ''}${tabCh.projet || tabTitle}`}
                      className={`min-h-[32px] px-3 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer transition-colors ${
                        isActiveTab
                          ? 'bg-white text-[#0a5b9c] shadow-xs'
                          : 'bg-white/10 hover:bg-white/20 text-white/95'
                      }`}
                    >
                      <span className="max-w-[180px] truncate">{tabTitle}</span>
                      {isStandby ? (
                        <PauseCircle
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActiveTab ? 'text-amber-600' : 'text-amber-300'
                          }`}
                        />
                      ) : tabSummary.todayCompleted &&
                        tabSummary.remainingToValidateCount === 0 ? (
                        <Check
                          className={`w-3.5 h-3.5 shrink-0 stroke-[3] ${
                            isActiveTab ? 'text-emerald-600' : 'text-emerald-300'
                          }`}
                        />
                      ) : tabSummary.remainingToValidateCount > 0 ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-black tabular-nums leading-none ${
                            isActiveTab
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-amber-400 text-amber-950'
                          }`}
                        >
                          {tabSummary.remainingToValidateCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </header>

        {/* Main Workspace */}
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 py-5 sm:py-7">
          {view === 'chantiers' && (
            <ChantiersView
              chantiers={chantiers}
              journalsByChantierId={journalsByChantierId}
              shareByChantierId={shareByChantierId}
              currentUserId={user.uid}
              currentUserEmail={user.email || ''}
              isColleagueOrAdmin={isColleagueOrAdmin}
              lastBackupIso={lastBackupIso}
              localMigrationCount={unmigratedLocalCount}
              migratingLocal={migratingLocal}
              onMigrateLocal={handleMigrateLocal}
              onSelectChantier={(id) => {
                setCurrentChantierId(id);
                setView('chantier');
                window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
              }}
              onOpenTodayJournal={(ch) => void handleOpenTodayJournal(ch)}
              onPutChantierStandby={(ch) => void handlePutChantierStandby(ch)}
              onOpenResumeModal={(ch) =>
                setStandbyModalState({ chantier: ch, initialKind: 'standby' })
              }
              onOpenJcModal={(ch) =>
                setStandbyModalState({ chantier: ch, initialKind: 'jc' })
              }
              onArchiveChantier={handleArchiveChantier}
              onReopenChantier={(ch) => void handleReopenChantier(ch)}
              onNewChantier={() => {
                setEditingChantier(null);
                setChantierModalOpen(true);
              }}
              onEditChantier={(ch) => {
                setEditingChantier(ch);
                setChantierModalOpen(true);
              }}
              onDeleteChantier={handleDeleteChantier}
              onRedeemInvite={handleRedeemInvite}
              onExportJson={handleExportJson}
              onImportJsonFile={handleImportJsonFile}
              onRefresh={() => void refreshChantiersFromCloud(user, false)}
              refreshing={refreshingChantiers}
            />
          )}

          {view === 'chantier' && currentChantier && (
            <ChantierDetailView
              chantier={currentChantier}
              allChantiers={chantiers}
              journals={chantierJournals}
              shareInfo={shareByChantierId[currentChantier.id] || null}
              currentUserId={user.uid}
              currentUserEmail={user.email || ''}
              signingSession={signingSession}
              onResetSigningSession={() => {
                setSigningSession(null);
                notify('Session de vérification réinitialisée.');
              }}
              onSelectChantier={(id) => {
                setCurrentChantierId(id);
                window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
              }}
              onBack={() => {
                setView('chantiers');
                setCurrentChantierId(null);
              }}
              onEditChantier={() => {
                setEditingChantier(currentChantier);
                setChantierModalOpen(true);
              }}
              onOpenShareAccess={() => setShareAccessModalOpen(true)}
              onShareHtml={() => {
                const fn = exportShareableHTML(
                  currentChantier,
                  chantierJournals
                );
                notify(`Fiche HTML partagée : ${fn}`, 'success');
              }}
              onNewJournal={handleNewJournal}
              onOpenJournal={(jId) => {
                setCurrentJournalId(jId);
                setView('journal');
                window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
              }}
              onDuplicateJournal={handleDuplicateJournal}
              onDeleteJournal={handleDeleteJournal}
              onPutStandby={() => void handlePutChantierStandby(currentChantier)}
              onOpenResumeModal={() =>
                setStandbyModalState({
                  chantier: currentChantier,
                  initialKind: 'standby',
                })
              }
              onOpenJcModal={() =>
                setStandbyModalState({
                  chantier: currentChantier,
                  initialKind: 'jc',
                })
              }
              onArchiveChantier={() => handleArchiveChantier(currentChantier)}
              onReopenChantier={() => void handleReopenChantier(currentChantier)}
              onSignJournals={(list, role, label) => {
                void handleRequestSignJournals(list, role, label);
              }}
              onPrintWeek={(wkJournals) =>
                triggerPrint(currentChantier, wkJournals)
              }
              onExportWeekPdf={handleExportWeekPdf}
              onRefresh={() =>
                void refreshJournalsFromCloud(currentChantier, user, false)
              }
              refreshing={refreshingJournals}
            />
          )}

          {view === 'journal' && currentChantier && currentJournal && (
            <JournalEditorView
              chantier={currentChantier}
              journal={currentJournal}
              allJournals={chantierJournals}
              previousJournal={previousJournal}
              isOwner={currentChantier.ownerId === user.uid}
              isDelegate={
                currentChantier.ownerId !== user.uid &&
                isUserDelegateOnChantier(currentChantier, user.email)
              }
              currentUserId={user.uid}
              firmSuggestions={firmSuggestions}
              travauxSuggestions={travauxSuggestions}
              onSelectJournal={async (jId) => {
                await flushPendingJournalSave();
                setCurrentJournalId(jId);
                window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
              }}
              onChange={handleUpdateJournal}
              onToggleStatus={handleToggleJournalStatus}
              onSignPage={(role) => {
                void handleRequestSignJournals(
                  [currentJournal],
                  role,
                  `${fmtDateJJMMAA(currentJournal.date)} (N° ${currentJournal.journalNum})`
                );
              }}
              onBack={async () => {
                await flushPendingJournalSave();
                setView('chantier');
                setCurrentJournalId(null);
              }}
              onPrintSingle={() =>
                triggerPrint(currentChantier, [currentJournal])
              }
              onExportDayPdf={handleExportDayPdf}
              onNotify={notify}
            />
          )}

          {view === 'acces' && isAdmin && (
            <AccessAdminView user={user} onNotify={notify} />
          )}

          {view === 'compte' && (
            <AccountView
              user={user}
              profile={effectiveProfile}
              isAdmin={isAdmin}
              onProfileUpdated={setProfile}
              onNotify={notify}
            />
          )}
        </main>

        {/* Subtle Signed Footer */}
        <footer className="py-4 px-4 text-center text-xs text-slate-400">
          Mes JDT · INASEP · {APP_SIGNATURE}
        </footer>
      </div>

      {/* Hidden Print Staging Root */}
      <div id="printRoot">
        {printPayload &&
          printPayload.journals.map((j) => (
            <A4JournalSheet
              key={j.id}
              chantier={printPayload.chantier}
              journal={j}
            />
          ))}
      </div>

      {/* Modals & Toasts */}
      <ChantierModal
        open={chantierModalOpen}
        editingChantier={editingChantier}
        defaultPrepose={effectiveProfile.defaultPrepose}
        defaultHoraireDebut={effectiveProfile.defaultHoraireDebut}
        defaultHoraireFin={effectiveProfile.defaultHoraireFin}
        onClose={() => {
          setChantierModalOpen(false);
          setEditingChantier(null);
        }}
        onSave={handleSaveChantier}
        onNotify={notify}
      />

      {currentChantier && (
        <ShareAccessModal
          open={shareAccessModalOpen}
          chantier={currentChantier}
          user={user}
          onClose={() => setShareAccessModalOpen(false)}
          onNotify={notify}
        />
      )}

      {signModalState && currentChantier && (
        <SignatureModal
          open={Boolean(signModalState)}
          role={signModalState.role}
          chantier={currentChantier}
          defaultSignerName={
            signModalState.role === 'controleur' &&
            currentChantier.ownerId !== user.uid
              ? currentChantier.delegateName?.trim() ||
                effectiveProfile.displayName ||
                user.displayName ||
                ''
              : effectiveProfile.defaultPrepose || effectiveProfile.displayName
          }
          signerEmail={user.email || ''}
          signerUid={user.uid}
          getIdToken={() => user.getIdToken()}
          targetLabel={signModalState.targetLabel}
          targetJournals={signModalState.targetJournals}
          existingSession={signingSession}
          onSessionVerified={setSigningSession}
          onConfirmSign={async (session, journalsToSign, onProgress) => {
            await executeSignJournals(
              session,
              signModalState.role,
              journalsToSign,
              onProgress
            );
          }}
          onClose={() => setSignModalState(null)}
        />
      )}

      <StandbyResumeModal
        open={Boolean(standbyModalState)}
        chantier={standbyModalState?.chantier || null}
        initialKind={standbyModalState?.initialKind || 'standby'}
        onClose={() => setStandbyModalState(null)}
        onConfirm={async (params) => {
          if (!standbyModalState) return;
          await handleConfirmStandbyResume(standbyModalState.chantier, params);
        }}
        onCancelStandby={
          standbyModalState?.chantier.jdtStatus === 'standby'
            ? async () => {
                if (!standbyModalState) return;
                await handleCancelStandby(standbyModalState.chantier);
              }
            : undefined
        }
      />

      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel}
        danger={confirmState?.danger}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />

      <JsonImportModal
        pendingData={pendingJsonImport}
        onReplace={() => void applyJsonImport(true)}
        onMerge={() => void applyJsonImport(false)}
        onCancel={() => setPendingJsonImport(null)}
      />

      <PdfProgressModal progress={pdfProgress} />
      <OfflineIndicator />
      <Toast toast={toast} />
    </>
  );
}
