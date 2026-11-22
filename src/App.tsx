import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LogOut, Shield, UserCircle2 } from 'lucide-react';
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
import { Toast, type ToastState } from './components/Toast';
import { auth, isAdminEmail } from './firebase';
import {
  APP_SIGNATURE,
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
  todayISO,
  weekKey,
} from './utils/dates';
import {
  buildLocalDefaultProfile,
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
import { exportShareableHTML } from './utils/shareHtml';
import {
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
    'approved' | AccessGateState | null
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
      await saveJournalCloud(pending.journal, pending.chantier, pending.user);
    }
  }, []);

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

    // Colleague: 1 single getDocFromServer read at startup (with localStorage offline fallback)
    try {
      const res = await checkUserAccessStartup(nextUser);
      setAccessState(res.state);
      setAccessErrorMessage(
        res.state === 'quota_exceeded' ? res.errorMessage : null
      );
    } catch (err) {
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

  const refreshChantiersFromCloud = useCallback(
    async (targetUser: User, silent = false) => {
      setRefreshingChantiers(true);
      try {
        const res = await fetchChantiersAndSharesOnce(targetUser.uid);
        setChantiers(res.chantiers);
        setShareByChantierId(res.shareByChantierId);
        setChantiersLoaded(true);
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
    [notify]
  );

  // Load Chantiers once approved: show local cache immediately, and sync latest version from cloud when online
  const lastSyncRef = useRef<number>(0);

  useEffect(() => {
    const isAuthorized = Boolean(
      user &&
        (user.emailVerified || isGoogleAccount(user)) &&
        (isAdmin || accessState === 'approved')
    );
    if (!isAuthorized || !user) {
      setChantiers([]);
      setShareByChantierId({});
      setChantierJournals([]);
      setChantiersLoaded(false);
      return;
    }

    const cached = getCachedChantiersBundle(user.uid);
    if (cached) {
      setChantiers(cached.chantiers);
      setShareByChantierId(cached.shareByChantierId);
      setChantiersLoaded(true);
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
        (isAdmin || accessState === 'approved')
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
            void fetchChantierJournauxOnce(ch, user.uid)
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

  // Redeem pending URL ?invite=CODE automatically once user is approved & logged in
  useEffect(() => {
    if (
      !pendingInviteCode ||
      !user ||
      (!user.emailVerified && !isGoogleAccount(user)) ||
      (!isAdmin && accessState !== 'approved')
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
        const list = await fetchChantierJournauxOnce(chantier, targetUser.uid);
        setChantierJournals(list);
        if (!silent) {
          notify('Journaux actualisés.', 'success');
        }
      } catch (err) {
        const cached = getCachedJournals(chantier.id);
        if (cached) {
          setChantierJournals(cached);
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

  const isCurrentJournalInCompletedWeek = useMemo(() => {
    if (!currentJournal) return false;
    const targetWk = weekKey(currentJournal.date);
    const sameWeek = chantierJournals.filter(
      (j) => weekKey(j.date) === targetWk
    );
    return (
      sameWeek.length > 0 && sameWeek.every((j) => j.status === 'completed')
    );
  }, [chantierJournals, currentJournal]);

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
    const set = new Set<string>();
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
  const handleSaveChantier = async (chantier: Chantier) => {
    if (!user) return;
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
      setChantierModalOpen(false);
      setEditingChantier(null);
      if (view === 'chantier' && currentChantierId === saved.id) {
        setCurrentChantierId(saved.id);
      }
      notify('Chantier enregistré dans le cloud.', 'success');
    } catch (err) {
      notify(
        formatActionError(err, "Impossible d'enregistrer le chantier."),
        'error'
      );
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
      setChantierJournals((prev) => {
        const next = updater(prev).sort(
          (a, b) =>
            (a.date || '').localeCompare(b.date || '') ||
            a.journalNum - b.journalNum
        );
        setCachedJournals(chantierId, next);
        return next;
      });
    },
    []
  );

  const handleNewJournal = async () => {
    if (!currentChantier || !user) return;
    if (currentChantier.ownerId !== user.uid) return;

    const sorted = [...chantierJournals].sort(
      (a, b) =>
        (b.date || '').localeCompare(a.date || '') ||
        b.journalNum - a.journalNum
    );
    const maxNum = sorted.reduce((m, j) => Math.max(m, j.journalNum || 0), 0);
    const prevJournal = sorted[0];

    const newJ: Journal = {
      id: uid(),
      chantierId: currentChantier.id,
      chantierOwnerId: currentChantier.ownerId || user.uid,
      chantierReaderIds: currentChantier.readerIds || [],
      authorId: user.uid,
      authorName:
        profile?.displayName ||
        user.displayName ||
        user.email?.split('@')[0] ||
        'Utilisateur',
      status: 'in_progress',
      journalNum: maxNum + 1,
      date: todayISO(),
      horaireDebut:
        currentChantier.horaireDebut || profile?.defaultHoraireDebut || '07:30',
      horaireFin:
        currentChantier.horaireFin || profile?.defaultHoraireFin || '16:30',
      tempMatin: '',
      tempApresMidi: '',
      etatAtmo: [],
      ouvriers: [{ firme: currentChantier.entrepriseNom || '', metier: '', nbre: 1 }],
      travaux: prevJournal
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
    };

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
    if (currentChantier.ownerId !== user.uid) return;

    const maxNum = chantierJournals.reduce(
      (m, j) => Math.max(m, j.journalNum || 0),
      0
    );

    const copy: Journal = {
      ...source,
      id: uid(),
      chantierOwnerId: currentChantier.ownerId || user.uid,
      chantierReaderIds: currentChantier.readerIds || [],
      authorId: user.uid,
      authorName:
        profile?.displayName ||
        user.displayName ||
        user.email?.split('@')[0] ||
        'Utilisateur',
      status: 'in_progress',
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
    if (currentChantier.ownerId !== user.uid) return;
    if (updated.signatureControleur || updated.signatureLecteur) return;

    setEditingJournalDraft(updated);
    updateJournalsAndCache(currentChantier.id, (prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    pendingSaveRef.current = {
      journal: updated,
      chantier: currentChantier,
      user,
    };
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void flushPendingJournalSave();
    }, 350);
  };

  const handleToggleJournalStatus = async (
    nextStatus: 'in_progress' | 'completed'
  ) => {
    if (!currentChantier || !currentJournal || !user) return;
    if (currentChantier.ownerId !== user.uid) return;
    if (currentJournal.signatureControleur || currentJournal.signatureLecteur) {
      return;
    }

    const updated: Journal = { ...currentJournal, status: nextStatus };
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
          ? `Journal N° ${updated.journalNum} marqué comme terminé.`
          : `Journal N° ${updated.journalNum} repassé en cours.`,
        'success'
      );
    } catch (err) {
      notify(
        formatActionError(
          err,
          'Impossible de mettre à jour le statut de la page.'
        ),
        'error'
      );
    }
  };

  // Single-verification signing engine (1 verification -> 1 signature per page)
  const executeSignJournals = useCallback(
    async (
      session: VerifiedSigningSession,
      role: 'controleur' | 'lecteur',
      journalsToSign: Journal[]
    ) => {
      if (!currentChantier) return;
      await flushPendingJournalSave();

      for (const j of journalsToSign) {
        if (j.status !== 'completed') {
          throw new Error(
            `Le Journal N° ${j.journalNum} doit d'abord être marqué comme terminé.`
          );
        }
        const sigRecord = await signJournalPageWithSession(
          session,
          role,
          currentChantier,
          j
        );
        await signJournalPageCloud(currentChantier.id, j.id, role, sigRecord);

        updateJournalsAndCache(currentChantier.id, (prev) =>
          prev.map((item) =>
            item.id !== j.id
              ? item
              : role === 'controleur'
                ? { ...item, signatureControleur: sigRecord }
                : { ...item, signatureLecteur: sigRecord }
          )
        );

        setEditingJournalDraft((prev) => {
          if (!prev || prev.id !== j.id) return prev;
          return role === 'controleur'
            ? { ...prev, signatureControleur: sigRecord }
            : { ...prev, signatureLecteur: sigRecord };
        });
      }

      notify(
        `${journalsToSign.length} page${journalsToSign.length > 1 ? 's' : ''} signée${journalsToSign.length > 1 ? 's' : ''} (${session.method === 'itsme' ? 'itsme®' : 'Carte eID'}).`,
        'success'
      );
    },
    [currentChantier, flushPendingJournalSave, notify, updateJournalsAndCache]
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

    if (signingSession && signingSession.signerUid === user.uid) {
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
        const list = await fetchChantierJournauxOnce(ch, user.uid);
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
  if (!isAdmin && accessState !== 'approved') {
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
          onActivated={() => {
            setAccessState('approved');
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

  const effectiveProfile: UserProfile =
    profile || buildLocalDefaultProfile(user);

  return (
    <>
      <div id="app-shell" className="min-h-screen flex flex-col bg-[#f4f6f9]">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-[#0a5b9c] text-white border-b border-[#063f6e] shadow-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
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
        </header>

        {/* Main Workspace */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
          {view === 'chantiers' && (
            <ChantiersView
              chantiers={chantiers}
              shareByChantierId={shareByChantierId}
              currentUserId={user.uid}
              lastBackupIso={lastBackupIso}
              localMigrationCount={unmigratedLocalCount}
              migratingLocal={migratingLocal}
              onMigrateLocal={handleMigrateLocal}
              onSelectChantier={(id) => {
                setCurrentChantierId(id);
                setView('chantier');
                window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
              }}
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
              previousJournal={previousJournal}
              isOwner={currentChantier.ownerId === user.uid}
              isInCompletedWeek={isCurrentJournalInCompletedWeek}
              firmSuggestions={firmSuggestions}
              travauxSuggestions={travauxSuggestions}
              onChange={handleUpdateJournal}
              onToggleStatus={handleToggleJournalStatus}
              onSignPage={(role) => {
                void handleRequestSignJournals(
                  [currentJournal],
                  role,
                  `Journal N° ${currentJournal.journalNum} (${fmtDateFR(
                    currentJournal.date
                  )})`
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

      {signModalState && (
        <SignatureModal
          open={Boolean(signModalState)}
          role={signModalState.role}
          defaultSignerName={
            effectiveProfile.defaultPrepose || effectiveProfile.displayName
          }
          signerEmail={user.email || ''}
          signerUid={user.uid}
          targetLabel={signModalState.targetLabel}
          targetJournals={signModalState.targetJournals}
          existingSession={signingSession}
          onSessionVerified={setSigningSession}
          onConfirmSign={async (session, journalsToSign) => {
            await executeSignJournals(
              session,
              signModalState.role,
              journalsToSign
            );
          }}
          onClose={() => setSignModalState(null)}
        />
      )}

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
