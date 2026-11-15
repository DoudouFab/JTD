import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Clock, LogOut, RefreshCw, UserCircle2 } from 'lucide-react';
import { A4JournalSheet } from './components/A4JournalSheet';
import { AccountView } from './components/AccountView';
import { AuthScreen } from './components/AuthScreen';
import { ChantierDetailView } from './components/ChantierDetailView';
import { ChantierModal } from './components/ChantierModal';
import { ChantiersView } from './components/ChantiersView';
import { ConfirmModal } from './components/ConfirmModal';
import { JournalEditorView } from './components/JournalEditorView';
import { JsonImportModal } from './components/JsonImportModal';
import { PdfProgressModal } from './components/PdfProgressModal';
import { ShareAccessModal } from './components/ShareAccessModal';
import { SignatureModal } from './components/SignatureModal';
import { Toast, type ToastState } from './components/Toast';
import { auth, isAdminEmail } from './firebase';
import {
  APP_SIGNATURE,
  INASEP_LOGO_DATA_URL,
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
  deleteChantierCloud,
  deleteJournalCloud,
  ensureUserProfile,
  fetchAllJournalsForChantier,
  importLocalDbToCloud,
  redeemShareInvite,
  saveChantierCloud,
  saveJournalCloud,
  signJournalPageCloud,
  subscribeChantierJournaux,
  subscribeChantiers,
  subscribeOwnerChantierShares,
  syncPendingReadersToJournals,
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

type ViewMode = 'chantiers' | 'chantier' | 'journal' | 'compte';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [, setAuthTick] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [checkingActivation, setCheckingActivation] = useState(false);

  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [shareByChantierId, setShareByChantierId] = useState<
    Record<string, ChantierShare>
  >({});
  const [chantiersLoaded, setChantiersLoaded] = useState(false);
  const [chantierJournals, setChantierJournals] = useState<Journal[]>([]);

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

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setSigningSession(null);
      if (nextUser && nextUser.emailVerified) {
        try {
          const prof = await ensureUserProfile(nextUser);
          setProfile(prof);
        } catch {
          setProfile({
            uid: nextUser.uid,
            displayName: nextUser.displayName || nextUser.email || 'Utilisateur',
            email: nextUser.email || undefined,
            role: isAdminEmail(nextUser.email) ? 'admin' : 'user',
            active: isAdminEmail(nextUser.email),
            defaultPrepose: isAdminEmail(nextUser.email) ? 'F. Pirquin' : '',
            defaultHoraireDebut: '07:30',
            defaultHoraireFin: '16:30',
          });
        }
      } else {
        setProfile(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Subscribe to Chantiers when authenticated + verified + active
  useEffect(() => {
    const isAuthorized = Boolean(
      user && user.emailVerified && (isAdmin || profile?.active)
    );
    if (!isAuthorized || !user) {
      setChantiers([]);
      setShareByChantierId({});
      setChantierJournals([]);
      setChantiersLoaded(false);
      return;
    }

    const unsub = subscribeChantiers(
      user.uid,
      ({ chantiers: nextCh, shareByChantierId: nextShares }) => {
        setChantiers(nextCh);
        setShareByChantierId(nextShares);
        setChantiersLoaded(true);
      },
      () => {
        notify('Erreur de synchronisation des chantiers.', 'error');
      }
    );
    return () => unsub();
  }, [user, profile, isAdmin, notify]);

  // Redeem pending URL ?invite=CODE automatically once user is approved & logged in
  useEffect(() => {
    if (
      !pendingInviteCode ||
      !user ||
      !user.emailVerified ||
      (!isAdmin && !profile?.active)
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
  }, [pendingInviteCode, user, profile, isAdmin, notify]);

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

  // Subscribe to selected Chantier's journals
  useEffect(() => {
    if (!user || !user.emailVerified || !currentChantier) {
      setChantierJournals([]);
      return;
    }
    const unsub = subscribeChantierJournaux(
      currentChantier,
      user.uid,
      setChantierJournals,
      () => {
        notify('Erreur de synchronisation des journaux.', 'error');
      }
    );
    return () => unsub();
  }, [user, currentChantier, notify]);

  // Background sync for chantier owner so all journals carry active reader UIDs
  useEffect(() => {
    if (!user || !currentChantier || currentChantier.ownerId !== user.uid) {
      return;
    }
    const unsub = subscribeOwnerChantierShares(
      currentChantier.id,
      user.uid,
      (shares) => {
        const now = Date.now();
        const activeReaderIds = shares
          .filter((s) => !s.revoked && s.expiresAtMs > now)
          .map((s) => s.readerUid);
        if (activeReaderIds.length > 0) {
          void syncPendingReadersToJournals(
            currentChantier,
            user.uid,
            activeReaderIds
          );
        }
      }
    );
    return () => unsub();
  }, [user, currentChantier]);

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
      notify(
        `Synchronisé : ${res.importedChantiers} chantier(s) et ${res.importedJournaux} journal(aux).`,
        'success'
      );
    } catch {
      notify('Erreur lors du transfert vers le cloud.', 'error');
    } finally {
      setMigratingLocal(false);
    }
  };

  // Redeem invite code manually from ChantiersView
  const handleRedeemInvite = async (code: string) => {
    if (!user) return;
    try {
      const res = await redeemShareInvite(code, user);
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

  // Chantier CRUD
  const handleSaveChantier = async (chantier: Chantier) => {
    if (!user) return;
    try {
      const saved = await saveChantierCloud(chantier, user);
      setChantierModalOpen(false);
      setEditingChantier(null);
      if (view === 'chantier' && currentChantierId === saved.id) {
        setCurrentChantierId(saved.id);
      }
      notify('Chantier enregistré dans le cloud.', 'success');
    } catch {
      notify("Impossible d'enregistrer le chantier.", 'error');
    }
  };

  const handleDeleteChantier = (ch: Chantier) => {
    setConfirmState({
      title: 'Supprimer le chantier ?',
      message: `Supprimer « ${ch.numero || ''} ${ch.projet || ''} » ainsi que tous ses journaux ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await deleteChantierCloud(ch.id);
          if (currentChantierId === ch.id) {
            setCurrentChantierId(null);
            setCurrentJournalId(null);
            setView('chantiers');
          }
          notify('Chantier supprimé.');
        } catch {
          notify('Erreur lors de la suppression du chantier.', 'error');
        }
      },
    });
  };

  // Journal CRUD
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
      setEditingJournalDraft(newJ);
      setCurrentJournalId(newJ.id);
      setView('journal');
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      notify('Impossible de créer le journal.', 'error');
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
      setEditingJournalDraft(copy);
      setCurrentJournalId(copy.id);
      setView('journal');
      notify(
        `Journal N° ${copy.journalNum} créé depuis le N° ${source.journalNum}.`,
        'success'
      );
    } catch {
      notify('Impossible de dupliquer le journal.', 'error');
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
          if (currentJournalId === j.id) {
            setCurrentJournalId(null);
            setEditingJournalDraft(null);
            setView('chantier');
          }
          notify('Journal supprimé.');
        } catch {
          notify('Permission refusée ou erreur lors de la suppression.', 'error');
        }
      },
    });
  };

  const handleUpdateJournal = (updated: Journal) => {
    if (!currentChantier || !user) return;
    if (currentChantier.ownerId !== user.uid) return;
    if (updated.signatureControleur || updated.signatureLecteur) return;

    setEditingJournalDraft(updated);
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
      notify(
        nextStatus === 'completed'
          ? `Journal N° ${updated.journalNum} marqué comme terminé.`
          : `Journal N° ${updated.journalNum} repassé en cours.`,
        'success'
      );
    } catch {
      notify('Impossible de mettre à jour le statut de la page.', 'error');
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
    [currentChantier, flushPendingJournalSave, notify]
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
        const list = await fetchAllJournalsForChantier(ch, user.uid);
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
    } catch {
      notify("Erreur lors de l'export JSON.", 'error');
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
      setCurrentChantierId(null);
      setCurrentJournalId(null);
      setView('chantiers');
      notify(
        `Import terminé : ${res.importedChantiers} chantier(s) et ${res.importedJournaux} journal(aux).`,
        'success'
      );
    } catch {
      notify("Erreur lors de l'importation vers le cloud.", 'error');
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

  // Gate if not signed in or email unverified
  if (!user || !user.emailVerified) {
    return (
      <AuthScreen
        unverifiedUser={user && !user.emailVerified ? user : null}
        onVerifiedRefresh={async () => {
          if (!auth.currentUser) return false;
          await auth.currentUser.reload();
          if (auth.currentUser.emailVerified) {
            await auth.currentUser.getIdToken(true);
            setUser(auth.currentUser);
            setAuthTick((t) => t + 1);
            const prof = await ensureUserProfile(auth.currentUser);
            setProfile(prof);
            return true;
          }
          setUser(auth.currentUser);
          setAuthTick((t) => t + 1);
          return false;
        }}
      />
    );
  }

  // Gate if awaiting Administrator approval (or deactivated)
  if (profile && !profile.active && !isAdmin) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-lg p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
            <Clock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">
            Compte en attente d&apos;autorisation
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Votre adresse e-mail (<strong>{user.email}</strong>) est vérifiée.
            Votre compte doit maintenant être autorisé par l&apos;administrateur
            avant de pouvoir accéder aux dossiers.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={checkingActivation}
              onClick={async () => {
                setCheckingActivation(true);
                try {
                  const prof = await ensureUserProfile(user);
                  setProfile(prof);
                  if (prof.active) {
                    notify('Votre compte est autorisé !', 'success');
                  } else {
                    notify('Toujours en attente d’autorisation.');
                  }
                } catch {
                  notify('Impossible de vérifier le statut.', 'error');
                } finally {
                  setCheckingActivation(false);
                }
              }}
              className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw
                className={`w-4 h-4 ${checkingActivation ? 'animate-spin' : ''}`}
              />
              Actualiser le statut
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold cursor-pointer"
            >
              Se déconnecter
            </button>
          </div>
        </div>
        <Toast toast={toast} />
      </div>
    );
  }

  const effectiveProfile: UserProfile = profile || {
    uid: user.uid,
    displayName: user.displayName || user.email || 'Utilisateur',
    email: user.email || undefined,
    role: isAdmin ? 'admin' : 'user',
    active: true,
    defaultPrepose: isAdmin ? 'F. Pirquin' : '',
    defaultHoraireDebut: '07:30',
    defaultHoraireFin: '16:30',
  };

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
              <img
                src={INASEP_LOGO_DATA_URL}
                alt="INASEP"
                className="h-8 sm:h-9 w-auto rounded-md bg-white px-1.5 py-0.5 shrink-0"
              />
              <div className="min-w-0">
                <div className="text-sm sm:text-base font-extrabold tracking-tight leading-tight truncate">
                  Journal des travaux
                </div>
                <div className="text-[11px] text-white/70 truncate">
                  INASEP · {APP_SIGNATURE}
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  await flushPendingJournalSave();
                  setView('chantiers');
                  setCurrentJournalId(null);
                }}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  view !== 'compte'
                    ? 'bg-white text-[#0a5b9c]'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                Chantiers
              </button>

              <button
                type="button"
                onClick={async () => {
                  await flushPendingJournalSave();
                  setView('compte');
                  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
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
          Journal des travaux INASEP · {APP_SIGNATURE}
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
      <Toast toast={toast} />
    </>
  );
}
