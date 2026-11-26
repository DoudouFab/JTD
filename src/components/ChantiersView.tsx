import { useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Building2,
  CalendarClock,
  CalendarOff,
  Check,
  ChevronRight,
  Clock,
  CloudUpload,
  Download,
  FolderArchive,
  FolderOpen,
  KeyRound,
  Lock,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserCheck,
} from 'lucide-react';
import type { Chantier, ChantierShare, Journal } from '../types';
import { fmtDateFR, fmtDateJJMMAA, getChantierDisplayTitle, todayISO } from '../utils/dates';
import { computeChantierJdtSummary, type ChantierJdtSummary } from '../utils/jdtStatus';

interface ChantiersViewProps {
  chantiers: Chantier[];
  journalsByChantierId: Record<string, Journal[]>;
  shareByChantierId: Record<string, ChantierShare>;
  currentUserId: string;
  currentUserEmail?: string;
  isColleagueOrAdmin?: boolean;
  lastBackupIso: string | null;
  localMigrationCount: number;
  migratingLocal: boolean;
  onMigrateLocal: () => void;
  onSelectChantier: (id: string) => void;
  onOpenTodayJournal: (ch: Chantier) => void;
  onPutChantierStandby: (ch: Chantier) => void;
  onOpenResumeModal: (ch: Chantier) => void;
  onOpenJcModal?: (ch: Chantier) => void;
  onArchiveChantier: (ch: Chantier) => void;
  onReopenChantier: (ch: Chantier) => void;
  onNewChantier: () => void;
  onEditChantier: (ch: Chantier) => void;
  onDeleteChantier: (ch: Chantier) => void;
  onRedeemInvite: (code: string) => Promise<void>;
  onExportJson: () => void;
  onImportJsonFile: (file: File) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

interface ChantierWithSummary {
  chantier: Chantier;
  summary: ChantierJdtSummary;
}

type GridColumnsMode = 'auto' | '1' | '2' | '3' | '4' | '5';
const COLS_STORAGE_KEY = 'jt_chantiers_cols_v1';

function getStoredColsMode(): GridColumnsMode {
  try {
    const val = localStorage.getItem(COLS_STORAGE_KEY);
    if (
      val === 'auto' ||
      val === '1' ||
      val === '2' ||
      val === '3' ||
      val === '4' ||
      val === '5'
    ) {
      return val;
    }
  } catch {
    // ignore storage errors
  }
  return 'auto';
}

function getGridClass(mode: GridColumnsMode): string {
  switch (mode) {
    case '1':
      return 'grid grid-cols-1 gap-3';
    case '2':
      return 'grid grid-cols-1 sm:grid-cols-2 gap-3';
    case '3':
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';
    case '4':
      return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3';
    case '5':
      return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3';
    case 'auto':
    default:
      return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3';
  }
}

function getPriorityRank(summary: ChantierJdtSummary): number {
  if (summary.effectiveStatus === 'standby') return 3;
  if (summary.effectiveStatus === 'archived') return 4;
  if (summary.remainingToValidateCount > 0) return 0;
  if (summary.hasOpenJdt) return 1;
  return 2;
}

function sortChantiersByPriority(
  a: ChantierWithSummary,
  b: ChantierWithSummary
): number {
  const rankA = getPriorityRank(a.summary);
  const rankB = getPriorityRank(b.summary);
  if (rankA !== rankB) return rankA - rankB;

  if (rankA === 0) {
    if (b.summary.remainingToValidateCount !== a.summary.remainingToValidateCount) {
      return b.summary.remainingToValidateCount - a.summary.remainingToValidateCount;
    }
    if (a.summary.todayCompleted !== b.summary.todayCompleted) {
      return Number(a.summary.todayCompleted) - Number(b.summary.todayCompleted);
    }
  }

  if (rankA === 1) {
    if (a.summary.todayCompleted !== b.summary.todayCompleted) {
      return Number(b.summary.todayCompleted) - Number(a.summary.todayCompleted);
    }
  }

  if (rankA === 3) {
    const sbCmp = (b.chantier.standbySince || '').localeCompare(
      a.chantier.standbySince || ''
    );
    if (sbCmp !== 0) return sbCmp;
  }

  return (a.chantier.numero || a.chantier.projet || '').localeCompare(
    b.chantier.numero || b.chantier.projet || ''
  );
}

export function ChantiersView({
  chantiers,
  journalsByChantierId,
  shareByChantierId,
  currentUserId,
  currentUserEmail = '',
  isColleagueOrAdmin = true,
  lastBackupIso,
  localMigrationCount,
  migratingLocal,
  onMigrateLocal,
  onSelectChantier,
  onOpenTodayJournal,
  onPutChantierStandby,
  onOpenResumeModal,
  onOpenJcModal,
  onArchiveChantier,
  onReopenChantier,
  onNewChantier,
  onEditChantier,
  onDeleteChantier,
  onRedeemInvite,
  onExportJson,
  onImportJsonFile,
  onRefresh,
  refreshing,
}: ChantiersViewProps) {
  const [folderTab, setFolderTab] = useState<'open' | 'archives'>('open');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'todo' | 'done' | 'standby'
  >('all');
  const [gridCols, setGridCols] = useState<GridColumnsMode>(getStoredColsMode);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'shared'>('all');
  const [inviteCode, setInviteCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const today = todayISO();
  const normalizedQuery = query.trim().toLowerCase();
  const emailLower = currentUserEmail.trim().toLowerCase();
  const ownedCount = chantiers.filter((c) => c.ownerId === currentUserId).length;
  const sharedCount = chantiers.filter((c) => c.ownerId !== currentUserId).length;

  const handleChangeGridCols = (mode: GridColumnsMode) => {
    setGridCols(mode);
    try {
      localStorage.setItem(COLS_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  };

  const summaries = useMemo<ChantierWithSummary[]>(() => {
    return chantiers.map((chantier) => ({
      chantier,
      summary: computeChantierJdtSummary(
        chantier,
        journalsByChantierId[chantier.id] || [],
        today
      ),
    }));
  }, [chantiers, journalsByChantierId, today]);

  const activeItems = useMemo(
    () => summaries.filter((item) => item.summary.effectiveStatus !== 'archived'),
    [summaries]
  );
  const archivedItems = useMemo(
    () => summaries.filter((item) => item.summary.effectiveStatus === 'archived'),
    [summaries]
  );

  // Metrics on active open JDT dossiers
  const openJdtAll = useMemo(
    () => activeItems.filter((i) => i.summary.hasOpenJdt),
    [activeItems]
  );
  const doneTodayCount = useMemo(
    () =>
      openJdtAll.filter(
        (i) =>
          i.summary.effectiveStatus === 'active' && i.summary.todayCompleted
      ).length,
    [openJdtAll]
  );
  const totalRemainingDays = useMemo(
    () =>
      openJdtAll.reduce(
        (sum, i) => sum + i.summary.remainingToValidateCount,
        0
      ),
    [openJdtAll]
  );
  const standbyCount = useMemo(
    () =>
      activeItems.filter((i) => i.summary.effectiveStatus === 'standby').length,
    [activeItems]
  );

  const matchesSearchAndScope = ({ chantier }: ChantierWithSummary) => {
    const isMine = chantier.ownerId === currentUserId;
    if (scope === 'mine' && !isMine) return false;
    if (scope === 'shared' && isMine) return false;
    if (!normalizedQuery) return true;
    const hay = [
      chantier.pseudo,
      chantier.numero,
      chantier.projet,
      chantier.references,
      chantier.entrepriseNom,
      chantier.preposeSurveillance,
      chantier.adresseChantier,
      chantier.ownerName,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(normalizedQuery);
  };

  const filteredActive = useMemo(() => {
    return activeItems
      .filter((item) => {
        if (!matchesSearchAndScope(item)) return false;
        const { summary } = item;
        if (statusFilter === 'todo') {
          return (
            summary.effectiveStatus === 'active' &&
            summary.hasOpenJdt &&
            !summary.todayCompleted
          );
        }
        if (statusFilter === 'done') {
          return (
            summary.effectiveStatus === 'active' &&
            summary.hasOpenJdt &&
            summary.todayCompleted
          );
        }
        if (statusFilter === 'standby') {
          return summary.effectiveStatus === 'standby';
        }
        return true;
      })
      .sort(sortChantiersByPriority);
  }, [activeItems, statusFilter, scope, normalizedQuery, currentUserId]);

  const filteredOpenJdts = useMemo(
    () =>
      filteredActive
        .filter((i) => i.summary.hasOpenJdt)
        .sort(sortChantiersByPriority),
    [filteredActive]
  );
  const filteredUnopenedJdts = useMemo(
    () =>
      filteredActive
        .filter((i) => !i.summary.hasOpenJdt)
        .sort(sortChantiersByPriority),
    [filteredActive]
  );

  const filteredArchived = useMemo(
    () =>
      archivedItems
        .filter(matchesSearchAndScope)
        .sort((a, b) =>
          (b.chantier.closedAt || '').localeCompare(a.chantier.closedAt || '')
        ),
    [archivedItems, scope, normalizedQuery, currentUserId]
  );

  const handleRedeemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = inviteCode.trim();
    if (!cleaned) return;
    setRedeeming(true);
    try {
      await onRedeemInvite(cleaned);
      setInviteCode('');
    } finally {
      setRedeeming(false);
    }
  };

  const formattedBackupDate = lastBackupIso
    ? (() => {
        const d = new Date(lastBackupIso);
        return Number.isNaN(d.getTime())
          ? null
          : `${d.toLocaleDateString('fr-BE')} à ${d.toLocaleTimeString('fr-BE', {
              hour: '2-digit',
              minute: '2-digit',
            })}`;
      })()
    : null;

  const renderChantierCard = ({ chantier: ch, summary }: ChantierWithSummary) => {
    const isOwner = ch.ownerId === currentUserId;
    const isDelegate =
      !isOwner &&
      Boolean(
        emailLower &&
          (ch.delegateEmails || []).some(
            (em) => em.trim().toLowerCase() === emailLower
          )
      );
    const canAuthor = isOwner || isDelegate;
    const shareInfo = shareByChantierId[ch.id];
    const isStandby = summary.effectiveStatus === 'standby';
    const isArchived = summary.effectiveStatus === 'archived';
    const hasOpenJdt = summary.hasOpenJdt;
    const isTodayDone = !isStandby && !isArchived && summary.todayCompleted;
    const remainingDays = summary.remainingToValidateCount;

    return (
      <article
        key={ch.id}
        onClick={() => onSelectChantier(ch.id)}
        className={`group rounded-xl border bg-white p-3 transition-all cursor-pointer flex flex-col justify-between ${
          isTodayDone
            ? 'border-emerald-300/90 hover:border-emerald-400 shadow-xs'
            : isStandby
              ? 'border-amber-300/90 hover:border-amber-400'
              : isArchived
                ? 'border-slate-200 bg-slate-50/40 hover:border-slate-300'
                : 'border-slate-200 hover:border-[#0a5b9c]/50 hover:shadow-sm'
        }`}
      >
        <div className="space-y-2.5">
          {/* Compact Top Visual JDT Status Strip */}
          {isArchived ? (
            <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 truncate">
                <FolderArchive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span className="truncate">Clôturé</span>
              </div>
              {ch.closedAt && (
                <span className="text-[10px] font-semibold text-slate-500 tabular-nums shrink-0">
                  {fmtDateFR(ch.closedAt)}
                </span>
              )}
            </div>
          ) : isStandby ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200/80 px-2.5 py-1.5 flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <PauseCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-extrabold text-amber-950 truncate">
                    Staté (stand-by)
                  </div>
                  <div className="text-[10px] font-medium text-amber-800 tabular-nums truncate">
                    {ch.standbySince
                      ? `Depuis ${fmtDateFR(ch.standbySince)}`
                      : 'Décompte suspendu'}
                  </div>
                </div>
              </div>
            </div>
          ) : isTodayDone ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-extrabold text-emerald-900 truncate">
                    Terminé
                  </div>
                  <div className="text-[10px] font-medium text-emerald-700 tabular-nums truncate">
                    {remainingDays > 0
                      ? `OK · ${remainingDays} à valider`
                      : `${fmtDateJJMMAA(summary.todayJournal?.date)} OK`}
                  </div>
                </div>
              </div>
            </div>
          ) : hasOpenJdt && remainingDays > 0 ? (
            <div className="rounded-lg bg-amber-50/90 border border-amber-200 px-2.5 py-1.5 flex items-center justify-between gap-1.5">
              <div className="min-w-0">
                <div className="text-[11px] font-extrabold text-amber-950 truncate">
                  {remainingDays} j. à valider
                </div>
                <div className="text-[10px] font-medium text-amber-800 tabular-nums truncate">
                  {summary.todayJournal
                    ? `${fmtDateJJMMAA(summary.todayJournal.date)} en cours`
                    : summary.missingWorkdaysCount > 0
                      ? `${summary.missingWorkdaysCount} manquant(s)`
                      : `${summary.inProgressCount} en cours`}
                </div>
              </div>
              <div className="w-7 h-7 rounded-lg bg-amber-600 text-white font-extrabold text-xs flex items-center justify-center tabular-nums shrink-0 shadow-xs">
                {remainingDays}
              </div>
            </div>
          ) : hasOpenJdt ? (
            <div className="rounded-lg bg-[#0a5b9c]/[0.06] border border-[#0a5b9c]/20 px-2.5 py-1.5 flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <Check className="w-3.5 h-3.5 text-[#0a5b9c] shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-[#0a5b9c] truncate">
                    À jour
                  </div>
                  <div className="text-[10px] text-slate-600 tabular-nums truncate">
                    {summary.latestJournal
                      ? `${fmtDateJJMMAA(summary.latestJournal.date)} · N° ${summary.latestJournal.journalNum}`
                      : 'Prêt'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-slate-100/80 px-2.5 py-1.5 flex items-center justify-between gap-1.5">
              <span className="text-[11px] font-semibold text-slate-600 truncate">
                JDT non ouvert
              </span>
              <span className="text-[10px] font-mono text-slate-500">N° 1</span>
            </div>
          )}

          {/* Dossier Identity */}
          <div>
            <div className="flex items-start justify-between gap-1.5">
              <div className="min-w-0">
                <div className="text-[11px] font-mono font-semibold text-[#0a5b9c] uppercase tracking-wide truncate">
                  {ch.numero || 'Sans N°'}
                  {ch.references ? ` · ${ch.references}` : ''}
                </div>
                <h2 className="text-base font-black text-slate-900 mt-0.5 line-clamp-2 leading-snug tracking-tight group-hover:text-[#0a5b9c] transition-colors">
                  {getChantierDisplayTitle(ch)}
                </h2>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#0a5b9c] shrink-0 mt-0.5 transition-colors" />
            </div>

            <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
              <div className="truncate font-semibold text-slate-700">
                {ch.entrepriseNom || '—'}
              </div>
              <div className="flex items-center justify-between gap-1.5 text-slate-500 tabular-nums">
                <span className="truncate">
                  {summary.latestJournal
                    ? `${fmtDateJJMMAA(summary.latestJournal.date)} · N° ${summary.latestJournal.journalNum}`
                    : ch.preposeSurveillance || '—'}
                </span>
                <span className="shrink-0 font-semibold text-slate-700">
                  {summary.journalCount} p.
                </span>
              </div>
              {(ch.standbyPeriods?.length || 0) > 0 && (
                <div className="text-[10px] text-amber-800 font-medium tabular-nums truncate">
                  {(() => {
                    const sb = ch.standbyPeriods!.filter((p) => (p.kind || 'standby') === 'standby').length;
                    const jc = ch.standbyPeriods!.filter((p) => p.kind === 'jc').length;
                    return [
                      sb > 0 ? `${sb} statage${sb > 1 ? 's' : ''}` : '',
                      jc > 0 ? `${jc} JC` : '',
                    ].filter(Boolean).join(' · ');
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className="mt-3 pt-2.5 border-t border-slate-100 space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Primary & Lifecycle Row */}
          {canAuthor && !isArchived && (
            <div className="flex flex-wrap items-center gap-1">
              {!isStandby ? (
                <button
                  type="button"
                  onClick={() => onOpenTodayJournal(ch)}
                  className={`flex-1 min-h-[34px] px-2.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                    isTodayDone
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-[#0a5b9c] hover:bg-[#063f6e] text-white'
                  }`}
                >
                  {summary.journalCount === 0
                    ? 'Ouvrir N° 1'
                    : isTodayDone
                      ? 'Voir ✓'
                      : 'Rédiger'}
                </button>
              ) : isOwner ? (
                <button
                  type="button"
                  onClick={() => onOpenResumeModal(ch)}
                  className="flex-1 min-h-[34px] px-2.5 rounded-lg bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <Play className="w-3 h-3" />
                  Reprendre
                </button>
              ) : null}

              {isOwner && !isStandby && (
                <button
                  type="button"
                  onClick={() => onPutChantierStandby(ch)}
                  title="Mettre le JDT en stand-by (chantier staté)"
                  className="min-h-[34px] px-2 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <PauseCircle className="w-3 h-3" />
                  Staté
                </button>
              )}

              {isOwner && !isStandby && onOpenJcModal && (
                <button
                  type="button"
                  onClick={() => onOpenJcModal(ch)}
                  title="Encoder des congés entreprise (JC) en 1 page récapitulative"
                  className="min-h-[34px] px-2 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-900 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <CalendarOff className="w-3 h-3" />
                  JC
                </button>
              )}

              {isOwner && !isStandby && (
                <button
                  type="button"
                  onClick={() => onOpenResumeModal(ch)}
                  title="Encoder des dates de statage et reprendre le suivi"
                  className="min-h-[34px] px-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <CalendarClock className="w-3 h-3 text-[#0a5b9c]" />
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-1.5">
            <div className="text-[10px] text-slate-500 tabular-nums truncate flex items-center gap-1 min-w-0">
              {isOwner ? (
                <>
                  <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">
                    {(ch.delegateEmails?.length || 0) > 0
                      ? `Remplaçant (${ch.delegateName || ch.delegateEmails![0]})`
                      : (ch.readerIds?.length || 0) +
                            (ch.readerEmails?.length || 0) >
                          0
                        ? `${(ch.readerIds?.length || 0) + (ch.readerEmails?.length || 0)} lecteur(s)`
                        : 'Personnel'}
                  </span>
                </>
              ) : isDelegate ? (
                <>
                  <UserCheck className="w-3 h-3 text-indigo-600 shrink-0" />
                  <span className="text-indigo-700 font-semibold truncate">
                    Rédacteur délégué
                  </span>
                </>
              ) : (
                <>
                  <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                  <span className="text-amber-800 font-medium truncate">
                    {shareInfo
                      ? `Lecture · ${new Date(
                          shareInfo.expiresAtMs
                        ).toLocaleDateString('fr-BE')}`
                      : 'Lecture & signature'}
                  </span>
                </>
              )}
            </div>

            {isOwner && (
              <div className="flex items-center gap-0.5 shrink-0 -mr-1">
                {!isArchived ? (
                  <button
                    type="button"
                    onClick={() => onArchiveChantier(ch)}
                    className="min-h-[30px] px-2 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    title="Clôturer le JDT et classer dans les archives"
                  >
                    <Archive className="w-3 h-3 text-slate-500" />
                    Clôturer
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onReopenChantier(ch)}
                    className="min-h-[30px] px-2 rounded-md border border-[#0a5b9c]/35 bg-[#0a5b9c]/[0.06] hover:bg-[#0a5b9c]/10 text-[#0a5b9c] text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    title="Réouvrir le suivi de ce chantier"
                  >
                    <ArchiveRestore className="w-3 h-3" />
                    Réouvrir
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onEditChantier(ch)}
                  className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-md text-slate-400 hover:text-[#0a5b9c] hover:bg-slate-100 cursor-pointer"
                  title="Modifier le chantier"
                  aria-label="Modifier le chantier"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteChantier(ch)}
                  className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                  title="Supprimer le chantier"
                  aria-label="Supprimer le chantier"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-6">
      {/* Local-to-Cloud One-Click Migration Banner */}
      {isColleagueOrAdmin && localMigrationCount > 0 && (
        <div className="rounded-2xl border border-[#0a5b9c]/30 bg-[#0a5b9c]/[0.06] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0a5b9c] text-white flex items-center justify-center shrink-0">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">
                Données locales détectées sur cet appareil
              </div>
              <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                {localMigrationCount} chantier(s) enregistré(s) localement
                peuvent être transférés dans votre espace cloud personnel.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={migratingLocal}
            onClick={onMigrateLocal}
            className="min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold cursor-pointer shrink-0 disabled:opacity-60"
          >
            {migratingLocal ? 'Transfert en cours…' : 'Synchroniser vers le Cloud'}
          </button>
        </div>
      )}

      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Tableau de suivi des JDT
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5 tabular-nums">
            {isColleagueOrAdmin ? (
              <>
                {ownedCount} dossier(s) personnel(s)
                {sharedCount > 0
                  ? ` · ${sharedCount} dossier(s) partagé(s)`
                  : ' · Espace privé synchronisé'}
              </>
            ) : (
              `${sharedCount} dossier(s) accessible(s) en lecture & signature`
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onRefresh && (
            <button
              type="button"
              disabled={refreshing}
              onClick={onRefresh}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-2 cursor-pointer disabled:opacity-60"
              title="Synchroniser depuis le cloud"
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">Actualiser</span>
            </button>
          )}
          {isColleagueOrAdmin && (
            <button
              type="button"
              onClick={onNewChantier}
              className="min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              Nouveau chantier
            </button>
          )}
        </div>
      </div>

      {/* Compact Live Overview Strip */}
      {chantiers.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 truncate">
              JDT ouverts
            </span>
            <span className="text-lg font-extrabold text-slate-900 tabular-nums shrink-0">
              {openJdtAll.length}
            </span>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 truncate">
              Validés aujourd&apos;hui
            </span>
            <span className="text-lg font-extrabold text-emerald-800 tabular-nums shrink-0">
              {doneTodayCount}
            </span>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-amber-800 truncate">
              Jours à valider
            </span>
            <span className="text-lg font-extrabold text-amber-900 tabular-nums shrink-0">
              {totalRemainingDays}
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 truncate">
              Statés / Archives
            </span>
            <span className="text-lg font-extrabold text-slate-900 tabular-nums shrink-0">
              {standbyCount}
              <span className="text-xs font-semibold text-slate-400">
                {' '}
                / {archivedItems.length}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Folder Tabs: En cours vs Archives */}
      {chantiers.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-200/80 border border-slate-200 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setFolderTab('open')}
              className={`min-h-[40px] px-4 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all tabular-nums ${
                folderTab === 'open'
                  ? 'bg-white text-[#0a5b9c] shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span>Chantiers en cours ({activeItems.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFolderTab('archives')}
              className={`min-h-[40px] px-4 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all tabular-nums ${
                folderTab === 'archives'
                  ? 'bg-white text-[#0a5b9c] shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              <FolderArchive className="w-4 h-4 shrink-0" />
              <span>Archives · Clôturés ({archivedItems.length})</span>
            </button>
          </div>

          {folderTab === 'open' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['all', 'Tous'],
                  ['todo', 'À valider'],
                  ['done', 'Aujourd’hui ✓'],
                  ['standby', 'Statés'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setStatusFilter(val)}
                  className={`min-h-[36px] px-3 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                    statusFilter === val
                      ? 'border-[#0a5b9c] bg-[#0a5b9c] text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search + Column Density + Scope Filter */}
      {chantiers.length > 0 && (
        <div className="flex flex-col md:flex-row md:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par numéro, projet, référence, entrepreneur…"
              className="w-full min-h-[42px] pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
            />
          </div>

          {/* Column selector (Auto or 1..5 columns) */}
          <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-slate-200/75 border border-slate-200 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2">
              Col.
            </span>
            {(['auto', '1', '2', '3', '4', '5'] as const).map((colVal) => (
              <button
                key={colVal}
                type="button"
                onClick={() => handleChangeGridCols(colVal)}
                title={
                  colVal === 'auto'
                    ? 'Disposition automatique selon la largeur d’écran'
                    : `Afficher sur ${colVal} colonne${colVal === '1' ? '' : 's'}`
                }
                className={`min-h-[32px] px-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  gridCols === colVal
                    ? 'bg-white text-[#0a5b9c] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {colVal === 'auto' ? 'Auto' : colVal}
              </button>
            ))}
          </div>

          {isColleagueOrAdmin && sharedCount > 0 && (
            <div className="grid grid-cols-3 p-1 rounded-xl bg-slate-200/75 border border-slate-200 shrink-0">
              {(
                [
                  ['all', 'Tous'],
                  ['mine', 'Mes chantiers'],
                  ['shared', 'Accès reçus'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setScope(val)}
                  className={`min-h-[32px] px-3 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap ${
                    scope === val
                      ? 'bg-white text-[#0a5b9c] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active vs Archives Grid */}
      {chantiers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 sm:p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            {isColleagueOrAdmin
              ? 'Aucun chantier enregistré'
              : 'Aucun dossier partagé avec cette adresse'}
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-1.5">
            {isColleagueOrAdmin
              ? "Créez votre premier chantier personnel ou saisissez un code d'accès temporaire pour consulter un dossier partagé avec vous."
              : "Saisissez un code d'invitation ci-dessous ou demandez au contrôleur d'ajouter votre adresse e-mail dans Modifier le chantier."}
          </p>
          {isColleagueOrAdmin && (
            <button
              type="button"
              onClick={onNewChantier}
              className="mt-5 min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Créer un chantier
            </button>
          )}
        </div>
      ) : folderTab === 'archives' ? (
        filteredArchived.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <FolderArchive className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-700">
              Aucun JDT clôturé dans les archives
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Utilisez le bouton « Clôturer JDT » sur un chantier terminé pour
              l&apos;archiver ici et arrêter son suivi.
            </p>
          </div>
        ) : (
          <div className={getGridClass(gridCols)}>
            {filteredArchived.map(renderChantierCard)}
          </div>
        )
      ) : filteredOpenJdts.length === 0 && filteredUnopenedJdts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-600">
            Aucun chantier ne correspond à ce filtre.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setScope('all');
              setStatusFilter('all');
            }}
            className="mt-3 text-sm font-semibold text-[#0a5b9c] hover:underline cursor-pointer"
          >
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredOpenJdts.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  Chantiers avec JDT ouvert ({filteredOpenJdts.length})
                </h2>
              </div>
              <div className={getGridClass(gridCols)}>
                {filteredOpenJdts.map(renderChantierCard)}
              </div>
            </section>
          )}

          {filteredUnopenedJdts.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                Dossiers sans JDT ouvert ({filteredUnopenedJdts.length})
              </h2>
              <div className={getGridClass(gridCols)}>
                {filteredUnopenedJdts.map(renderChantierCard)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Join Temporary Read-Only Chantier Bar */}
      <form
        onSubmit={handleRedeemSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center shrink-0">
            <KeyRound className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900">
              Consulter un dossier partagé temporairement
            </div>
            <div className="text-[11px] text-slate-500">
              Saisissez le code d&apos;invitation (ex. JDT-XXXXXX) transmis par
              le contrôleur.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="Code JDT-XXXXXX"
            className="w-44 sm:w-48 min-h-[42px] px-3 rounded-xl border border-slate-200 bg-slate-50 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] focus:bg-white"
          />
          <button
            type="submit"
            disabled={redeeming || !inviteCode.trim()}
            className="min-h-[42px] px-4 rounded-xl border border-[#0a5b9c] text-[#0a5b9c] hover:bg-[#0a5b9c] hover:text-white font-semibold text-xs sm:text-sm cursor-pointer disabled:opacity-50 transition-colors"
          >
            {redeeming ? 'Validation…' : 'Accéder'}
          </button>
        </div>
      </form>

      {/* Backup & Export JSON Section */}
      {isColleagueOrAdmin && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <HardDriveIcon />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Archivage &amp; import de sauvegarde (.json)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Vos chantiers personnels sont synchronisés dans votre espace
                  cloud sur tous vos appareils. Vous pouvez aussi exporter ou
                  importer une archive <span className="font-mono">.json</span>.
                </p>
                {formattedBackupDate && (
                  <p className="text-xs text-emerald-700 font-medium mt-1 tabular-nums">
                    Dernière archive exportée : {formattedBackupDate}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onExportJson}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Exporter (.json)
              </button>

              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) onImportJsonFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Importer (.json)
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function HardDriveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  );
}
