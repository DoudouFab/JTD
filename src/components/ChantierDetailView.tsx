import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  FileDown,
  Lock,
  Pencil,
  Plus,
  Printer,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import type { Chantier, ChantierShare, Journal } from '../types';
import {
  dayNameFR,
  fmtDateFR,
  weekKey,
  weekRangeLabel,
} from '../utils/dates';
import type { VerifiedSigningSession } from '../utils/signatureCrypto';

interface ChantierDetailViewProps {
  chantier: Chantier;
  allChantiers: Chantier[];
  journals: Journal[];
  shareInfo: ChantierShare | null;
  currentUserId: string;
  signingSession: VerifiedSigningSession | null;
  onResetSigningSession: () => void;
  onSelectChantier: (id: string) => void;
  onBack: () => void;
  onEditChantier: () => void;
  onOpenShareAccess: () => void;
  onShareHtml: () => void;
  onNewJournal: () => void;
  onOpenJournal: (journalId: string) => void;
  onDuplicateJournal: (journal: Journal) => void;
  onDeleteJournal: (journal: Journal) => void;
  onSignJournals: (
    journalsToSign: Journal[],
    role: 'controleur' | 'lecteur',
    targetLabel: string
  ) => void;
  onPrintWeek: (weekJournals: Journal[]) => void;
  onExportWeekPdf: (weekJournals: Journal[]) => void;
}

export function ChantierDetailView({
  chantier,
  allChantiers,
  journals,
  shareInfo,
  currentUserId,
  signingSession,
  onResetSigningSession,
  onSelectChantier,
  onBack,
  onEditChantier,
  onOpenShareAccess,
  onShareHtml,
  onNewJournal,
  onOpenJournal,
  onDuplicateJournal,
  onDeleteJournal,
  onSignJournals,
  onPrintWeek,
  onExportWeekPdf,
}: ChantierDetailViewProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const isOwner = chantier.ownerId === currentUserId;
  const currentRole: 'controleur' | 'lecteur' = isOwner
    ? 'controleur'
    : 'lecteur';

  const sorted = [...journals].sort(
    (a, b) =>
      (a.date || '').localeCompare(b.date || '') || a.journalNum - b.journalNum
  );

  // Full week grouping (never skewed by search filter)
  const allByWeek: Record<string, Journal[]> = {};
  for (const j of sorted) {
    const wk = weekKey(j.date);
    if (!allByWeek[wk]) allByWeek[wk] = [];
    allByWeek[wk].push(j);
  }

  const filtered = sorted.filter((j) => {
    if (!normalizedQuery) return true;
    const hay = [
      String(j.journalNum),
      fmtDateFR(j.date),
      dayNameFR(j.date),
      ...(j.travaux || []),
      ...(j.evenements || []),
      ...(j.decisions || []),
      ...(j.ouvriers || []).map((o) => `${o.firme} ${o.metier}`),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(normalizedQuery);
  });

  const byWeek: Record<string, Journal[]> = {};
  for (const j of filtered) {
    const wk = weekKey(j.date);
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(j);
  }
  const weeks = Object.keys(byWeek).sort().reverse();

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Chantiers</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-mono font-semibold text-[#0a5b9c] truncate flex items-center gap-1.5">
              <span>{chantier.numero || 'Chantier'}</span>
              {chantier.references ? (
                <span>· Réf. {chantier.references}</span>
              ) : null}
              <span>
                · {isOwner ? 'Dossier personnel' : 'Accès lecture temporaire'}
              </span>
            </div>
            {allChantiers.length > 1 ? (
              <select
                value={chantier.id}
                onChange={(e) => onSelectChantier(e.target.value)}
                aria-label="Changer de chantier"
                className="mt-0.5 max-w-full bg-transparent text-lg sm:text-xl font-extrabold text-slate-900 focus:outline-none cursor-pointer truncate pr-2"
              >
                {allChantiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.numero ? `${c.numero} — ` : ''}
                    {c.projet || 'Projet sans titre'}
                  </option>
                ))}
              </select>
            ) : (
              <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 truncate">
                {chantier.projet || 'Projet sans titre'}
              </h1>
            )}
          </div>
        </div>

        {isOwner && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onEditChantier}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Pencil className="w-4 h-4" />
              Modifier
            </button>
            <button
              type="button"
              onClick={onOpenShareAccess}
              className="min-h-[44px] px-3.5 rounded-xl border border-[#0a5b9c]/35 bg-[#0a5b9c]/[0.06] hover:bg-[#0a5b9c]/10 text-[#0a5b9c] font-semibold text-sm flex items-center gap-1.5 cursor-pointer"
              title="Accorder un accès temporaire en lecture sur ce dossier"
            >
              <Clock className="w-4 h-4" />
              Accès temporaire
              {(chantier.readerIds?.length || 0) > 0
                ? ` (${chantier.readerIds!.length})`
                : ''}
            </button>
            <button
              type="button"
              onClick={onShareHtml}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-1.5 cursor-pointer"
              title="Générer une fiche HTML en consultation seule"
            >
              <Share2 className="w-4 h-4" />
              HTML
            </button>
            <button
              type="button"
              onClick={onNewJournal}
              className="min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Nouveau journal
            </button>
          </div>
        )}
      </div>

      {/* Temporary Reader Banner */}
      {!isOwner && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-950 leading-relaxed">
              <strong>Consultation en lecture temporaire</strong> (dossier
              spécifique uniquement) : vous pouvez consulter les pages
              journalières terminées, la page en cours et les semaines
              terminées, signer chaque page d&apos;une semaine terminée via{' '}
              <strong>itsme® / eID</strong>, puis télécharger le PDF complet une
              fois toutes les pages signées par le contrôleur et vous-même.
            </div>
          </div>
          {shareInfo && (
            <div className="text-xs font-semibold text-amber-900 tabular-nums shrink-0">
              Valable jusqu&apos;au{' '}
              {new Date(shareInfo.expiresAtMs).toLocaleString('fr-BE')}
            </div>
          )}
        </div>
      )}

      {/* Active Single-Verification Session Bar */}
      {signingSession && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 text-xs text-emerald-950">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              Vérification active (
              <strong>
                {signingSession.method === 'itsme' ? 'itsme®' : 'Carte eID'}
              </strong>
              ) pour <strong>{signingSession.signerName}</strong> · Réf.{' '}
              <span className="font-mono">{signingSession.verificationId}</span>{' '}
              — vous pouvez signer les pages sans nouvelle vérification.
            </span>
          </div>
          <button
            type="button"
            onClick={onResetSigningSession}
            className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer self-start sm:self-center shrink-0"
          >
            Réinitialiser la vérification
          </button>
        </div>
      )}

      {/* Chantier Summary */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Entrepreneur
            </div>
            <div className="font-semibold text-slate-900 mt-0.5">
              {chantier.entrepriseNom || '—'}
            </div>
            {chantier.entrepriseAdresse && (
              <div className="text-xs text-slate-500 mt-0.5 whitespace-pre-line">
                {chantier.entrepriseAdresse}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Adresse chantier
            </div>
            <div className="font-medium text-slate-800 mt-0.5 whitespace-pre-line">
              {chantier.adresseChantier || '—'}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Surveillance INASEP
            </div>
            <div className="font-semibold text-slate-900 mt-0.5">
              {chantier.preposeSurveillance || '—'}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Horaire : {chantier.horaireDebut || '07:30'} –{' '}
              {chantier.horaireFin || '16:30'}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Bordereau &amp; journaux
            </div>
            <div className="font-semibold text-slate-900 mt-0.5 tabular-nums">
              {journals.length} journal{journals.length > 1 ? 'aux' : ''}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {chantier.postes.length} poste(s) Excel chargé(s)
            </div>
          </div>
        </div>
      </div>

      {/* Filter */}
      {journals.length > 0 && (
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer les journaux par N°, date, travaux, firme, événement…"
            className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
          />
        </div>
      )}

      {/* Weeks List */}
      {journals.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 sm:p-12 text-center">
          <h2 className="text-base font-bold text-slate-900">
            Aucun journal pour ce chantier
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {isOwner
              ? 'Créez le premier journal quotidien (N° 1) pour démarrer le suivi.'
              : 'Aucun journal n’a encore été enregistré sur ce chantier.'}
          </p>
          {isOwner && (
            <button
              type="button"
              onClick={onNewJournal}
              className="mt-4 min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Créer le journal N° 1
            </button>
          )}
        </div>
      ) : weeks.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">
            Aucun journal ne correspond à « {query} ».
          </p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-2 text-sm font-semibold text-[#0a5b9c] hover:underline cursor-pointer"
          >
            Réinitialiser le filtre
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {weeks.map((wk) => {
            const visibleWeekJournals = byWeek[wk];
            const fullWeekJournals = allByWeek[wk] || visibleWeekJournals;

            const completedCount = fullWeekJournals.filter(
              (j) => j.status === 'completed'
            ).length;
            const allCompleted =
              fullWeekJournals.length > 0 &&
              completedCount === fullWeekJournals.length;

            const signedCtrlCount = fullWeekJournals.filter((j) =>
              Boolean(j.signatureControleur)
            ).length;
            const signedReaderCount = fullWeekJournals.filter((j) =>
              Boolean(j.signatureLecteur)
            ).length;

            const allSignedCtrl =
              allCompleted && signedCtrlCount === fullWeekJournals.length;
            const allSignedReader =
              allCompleted && signedReaderCount === fullWeekJournals.length;
            const allFullySigned = allSignedCtrl && allSignedReader;

            const myUnsignedInWeek = allCompleted
              ? fullWeekJournals.filter((j) =>
                  currentRole === 'controleur'
                    ? !j.signatureControleur
                    : !j.signatureLecteur
                )
              : [];

            return (
              <section
                key={wk}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
              >
                {/* Week Header */}
                <div className="px-4 py-3.5 sm:px-5 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900">
                        {weekRangeLabel(wk)}
                      </h2>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                          allFullySigned
                            ? 'bg-emerald-100 text-emerald-800'
                            : allCompleted
                              ? 'bg-blue-100 text-[#0a5b9c]'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {allFullySigned
                          ? 'Semaine signée (Contrôleur + Lecteur)'
                          : allCompleted
                            ? 'Semaine terminée — Signatures requises'
                            : `Semaine en cours (${completedCount}/${fullWeekJournals.length} terminée(s))`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums mt-1">
                      {fullWeekJournals.length} page
                      {fullWeekJournals.length > 1 ? 's' : ''}
                      {allCompleted
                        ? ` · Contrôleur ${signedCtrlCount}/${fullWeekJournals.length} · Lecteur ${signedReaderCount}/${fullWeekJournals.length}`
                        : ''}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {allCompleted && myUnsignedInWeek.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onSignJournals(
                            myUnsignedInWeek,
                            currentRole,
                            weekRangeLabel(wk)
                          )
                        }
                        className="min-h-[40px] px-3.5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        Signer la semaine ({myUnsignedInWeek.length}p · itsme®/eID)
                      </button>
                    )}

                    {(isOwner || allFullySigned) && (
                      <button
                        type="button"
                        onClick={() => onPrintWeek(fullWeekJournals)}
                        className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer"
                      >
                        <Printer className="w-4 h-4" />
                        Imprimer
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!allFullySigned}
                      onClick={() => onExportWeekPdf(fullWeekJournals)}
                      title={
                        allFullySigned
                          ? 'Télécharger le PDF authentifié de la semaine'
                          : 'Disponible une fois toutes les pages terminées et signées par le contrôleur et le lecteur'
                      }
                      className={`min-h-[40px] px-3.5 rounded-xl font-semibold text-xs sm:text-sm flex items-center gap-1.5 transition-colors ${
                        allFullySigned
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                          : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      <FileDown className="w-4 h-4" />
                      {allFullySigned
                        ? 'Télécharger PDF semaine'
                        : 'PDF verrouillé (signatures)'}
                    </button>
                  </div>
                </div>

                {/* Daily Rows */}
                <div className="divide-y divide-slate-100">
                  {visibleWeekJournals.map((j) => {
                    const totalOuv = (j.ouvriers || []).reduce(
                      (s, o) => s + (Number(o.nbre) || 0),
                      0
                    );
                    const travauxClean = (j.travaux || [])
                      .map((x) => x.trim())
                      .filter(Boolean);
                    const summary =
                      travauxClean[0] ||
                      (j.etatAtmo?.length
                        ? j.etatAtmo.join(', ')
                        : 'Aucun détail saisi');

                    const isPageCompleted = j.status === 'completed';
                    const isSignedCtrl = Boolean(j.signatureControleur);
                    const isSignedReader = Boolean(j.signatureLecteur);
                    const isSignedAny = isSignedCtrl || isSignedReader;
                    const needsMySignature =
                      allCompleted &&
                      (currentRole === 'controleur'
                        ? !isSignedCtrl
                        : !isSignedReader);

                    return (
                      <div
                        key={j.id}
                        onClick={() => onOpenJournal(j.id)}
                        className="px-4 py-3 sm:px-5 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-center justify-between gap-3 min-h-[68px]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="text-sm font-bold text-[#0a5b9c] tabular-nums">
                              Journal N° {j.journalNum}
                            </span>
                            <span className="text-sm font-semibold text-slate-900 tabular-nums">
                              {dayNameFR(j.date)} {fmtDateFR(j.date)}
                            </span>
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                isPageCompleted
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {isPageCompleted ? 'Page terminée' : 'En cours'}
                            </span>
                            <span className="text-xs text-slate-500 inline-flex items-center gap-1 tabular-nums">
                              <Users className="w-3.5 h-3.5 text-slate-400" />
                              {totalOuv} ouvrier{totalOuv > 1 ? 's' : ''}
                            </span>
                          </div>

                          <p className="text-xs text-slate-600 truncate mt-1">
                            {summary}
                            {travauxClean.length > 1
                              ? ` (+${travauxClean.length - 1} ligne${
                                  travauxClean.length > 2 ? 's' : ''
                                })`
                              : ''}
                          </p>

                          {isPageCompleted && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px]">
                              <span
                                className={`inline-flex items-center gap-1 font-medium ${
                                  isSignedCtrl
                                    ? 'text-emerald-700'
                                    : 'text-slate-400'
                                }`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Contrôleur :{' '}
                                {isSignedCtrl
                                  ? `${j.signatureControleur!.signerName} (${j.signatureControleur!.method === 'itsme' ? 'itsme®' : 'eID'})`
                                  : 'Non signé'}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 font-medium ${
                                  isSignedReader
                                    ? 'text-emerald-700'
                                    : 'text-slate-400'
                                }`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Lecteur :{' '}
                                {isSignedReader
                                  ? `${j.signatureLecteur!.signerName} (${j.signatureLecteur!.method === 'itsme' ? 'itsme®' : 'eID'})`
                                  : 'Non signé'}
                              </span>
                            </div>
                          )}
                        </div>

                        <div
                          className="flex items-center gap-1.5 shrink-0 -mr-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {needsMySignature && (
                            <button
                              type="button"
                              onClick={() =>
                                onSignJournals(
                                  [j],
                                  currentRole,
                                  `Journal N° ${j.journalNum} (${fmtDateFR(j.date)})`
                                )
                              }
                              className="min-h-[38px] px-3 rounded-xl border border-[#0a5b9c] text-[#0a5b9c] hover:bg-[#0a5b9c] hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Signer
                            </button>
                          )}

                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => onDuplicateJournal(j)}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-[#0a5b9c] hover:bg-slate-100 cursor-pointer"
                              title="Dupliquer vers un nouveau journal"
                              aria-label="Dupliquer le journal"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          )}

                          {isOwner && !isSignedAny && (
                            <button
                              type="button"
                              onClick={() => onDeleteJournal(j)}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                              title="Supprimer le journal"
                              aria-label="Supprimer le journal"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
