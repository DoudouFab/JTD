import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Ban, LogOut, UserCircle2 } from 'lucide-react';
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
import { Toast, type ToastState } from './components/Toast';
import { auth, isAdminEmail } from './firebase';
import {
  APP_SIGNATURE,
  INASEP_LOGO_DATA_URL,
  type Chantier,
  type DB,
  type Journal,
  type UserProfile,
} from './types';
import {
  buildDailyFilename,
  buildWeeklyFilename,
  fmtDateFR,
  todayISO,
} from './utils/dates';
import {
  deleteChantierCloud,
  deleteJournalCloud,
  ensureUserProfile,
  fetchAllJournalsForChantier,
  importLocalDbToCloud,
  saveChantierCloud,
  saveJournalCloud,
  subscribeChantierJournaux,
  subscribeChantiers,
} from './utils/firestoreService';
import { generateAndDeliverPdf, type PdfProgress } from './utils/pdfExport';
import { exportShareableHTML } from './utils/shareHtml';
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
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [chantiers, setChantiers] = useState<Chantier[]>([]);
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

  const isAdmin = isAdminEmail(user?.email) || profile?.role === 'admin';

  const notify = useCallback(
    (message: string, tone: 'default' | 'success' | 'error' = 'default') => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      setToast({ message, tone });
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 3200);
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
            active: true,
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
    if (!user || !user.emailVerified || (profile && !profile.active)) {
      setChantiers([]);
      setChantierJournals([]);
      return;
    }
    const unsub = subscribeChantiers(
      user.uid,
      isAdmin,
      setChantiers,
      () => {
        notify('Erreur de synchronisation des chantiers.', 'error');
      }
    );
    return () => unsub();
  }, [user, profile, isAdmin, notify]);

  const currentChantier = useMemo(
    () => chantiers.find((c) => c.id === currentChantierId) || null,
    [chantiers, currentChantierId]
  );

  // Subscribe to selected Chantier's journals
  useEffect(() => {
    if (!user || !user.emailVerified || !currentChantier) {
      setChantierJournals([]);
      return;
    }
    const unsub = subscribeChantierJournaux(
      currentChantier,
      user.uid,
      isAdmin,
      setChantierJournals,
      () => {
        notify('Erreur de synchronisation des journaux.', 'error');
      }
    );
    return () => unsub();
  }, [user, currentChantier, isAdmin, notify]);

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

  // Chantier CRUD
  const handleSaveChantier = async (chantier: Chantier) => {
    if (!user) return;
    try {
      const saved = await saveChantierCloud(chantier, user, isAdmin);
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
      chantierVisibility: currentChantier.visibility || 'team',
      chantierMemberIds: currentChantier.memberIds || [],
      authorId: user.uid,
      authorName:
        profile?.displayName ||
        user.displayName ||
        user.email?.split('@')[0] ||
        'Utilisateur',
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
    const maxNum = chantierJournals.reduce(
      (m, j) => Math.max(m, j.journalNum || 0),
      0
    );

    const copy: Journal = {
      ...source,
      id: uid(),
      authorId: user.uid,
      authorName:
        profile?.displayName ||
        user.displayName ||
        user.email?.split('@')[0] ||
        'Utilisateur',
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

  // PDF Exports (with fallback to Account default folders!)
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

  const handleExportWeekPdf = async (weekJournals: Journal[]) => {
    if (!currentChantier || !weekJournals.length) return;
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
        label: 'Préparation de la semaine…',
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
          ? `${filename} (${sorted.length} pages) enregistré dans « ${res.folderName} »`
          : `${filename} (${sorted.length} pages) téléchargé`,
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

  // Full Cloud JSON Export / Import
  const handleExportJson = async () => {
    if (!user) return;
    try {
      const allJournals: Journal[] = [];
      for (const ch of chantiers) {
        const list = await fetchAllJournalsForChantier(ch, user.uid, isAdmin);
        allJournals.push(...list);
      }
      const payload: DB = { chantiers, journaux: allJournals };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const filename = `journal-travaux-backup-${todayISO()}.json`;
      downloadBlob(blob, filename);
      setLastBackupIso(markBackupDone());
      notify(
        `Archive exportée (${chantiers.length} chantier(s), ${allJournals.length} journal(aux)).`,
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
          if (isAdmin || ch.ownerId === user.uid) {
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
          if (!auth.currentUser) return;
          await auth.currentUser.reload();
          setUser({ ...auth.currentUser } as User);
          if (auth.currentUser.emailVerified) {
            const prof = await ensureUserProfile(auth.currentUser);
            setProfile(prof);
          }
        }}
      />
    );
  }

  // Gate if deactivated by Admin
  if (profile && !profile.active && !isAdminEmail(user.email)) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-lg p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
            <Ban className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">
            Accès désactivé
          </h2>
          <p className="text-sm text-slate-600">
            Votre compte ({user.email}) a été suspendu par l&apos;administrateur
            (F. Pirquin).
          </p>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="min-h-[44px] px-5 rounded-xl bg-slate-900 text-white text-sm font-semibold cursor-pointer"
          >
            Se déconnecter
          </button>
        </div>
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
                <div className="text-[11px] text-white/80 truncate">
                  INASEP · Signé{' '}
                  <span className="font-bold text-[#d9d61f]">
                    {APP_SIGNATURE}
                  </span>
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
                    ? 'bg-[#d9d61f] text-slate-950'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
                title="Mon compte, mot de passe, préférences et gestion des utilisateurs"
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
              currentUserId={user.uid}
              isAdmin={isAdmin}
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
              onExportJson={handleExportJson}
              onImportJsonFile={handleImportJsonFile}
            />
          )}

          {view === 'chantier' && currentChantier && (
            <ChantierDetailView
              chantier={currentChantier}
              allChantiers={chantiers}
              journals={chantierJournals}
              currentUserId={user.uid}
              isAdmin={isAdmin}
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
              firmSuggestions={firmSuggestions}
              travauxSuggestions={travauxSuggestions}
              onChange={handleUpdateJournal}
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
              chantiers={chantiers}
              onProfileUpdated={setProfile}
              onEditChantier={(ch) => {
                setEditingChantier(ch);
                setChantierModalOpen(true);
              }}
              onNotify={notify}
            />
          )}
        </main>

        {/* Subtle Signed Footer */}
        <footer className="py-4 px-4 text-center text-xs text-slate-400">
          Journal des travaux INASEP · Application signée{' '}
          <span className="font-semibold text-slate-600">{APP_SIGNATURE}</span>
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
        currentUserId={user.uid}
        isAdmin={isAdmin}
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
