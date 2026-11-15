import { useState } from 'react';
import {
  ArrowLeft,
  Copy,
  FileDown,
  Pencil,
  Plus,
  Printer,
  Search,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import type { Chantier, Journal } from '../types';
import {
  dayNameFR,
  fmtDateFR,
  weekKey,
  weekRangeLabel,
} from '../utils/dates';

interface ChantierDetailViewProps {
  chantier: Chantier;
  allChantiers: Chantier[];
  journals: Journal[];
  currentUserId: string;
  isAdmin: boolean;
  onSelectChantier: (id: string) => void;
  onBack: () => void;
  onEditChantier: () => void;
  onShareHtml: () => void;
  onNewJournal: () => void;
  onOpenJournal: (journalId: string) => void;
  onDuplicateJournal: (journal: Journal) => void;
  onDeleteJournal: (journal: Journal) => void;
  onPrintWeek: (weekJournals: Journal[]) => void;
  onExportWeekPdf: (weekJournals: Journal[]) => void;
}

export function ChantierDetailView({
  chantier,
  allChantiers,
  journals,
  currentUserId,
  isAdmin,
  onSelectChantier,
  onBack,
  onEditChantier,
  onShareHtml,
  onNewJournal,
  onOpenJournal,
  onDuplicateJournal,
  onDeleteJournal,
  onPrintWeek,
  onExportWeekPdf,
}: ChantierDetailViewProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const sorted = [...journals].sort(
    (a, b) =>
      (a.date || '').localeCompare(b.date || '') || a.journalNum - b.journalNum
  );

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
            <div className="text-xs font-mono font-semibold text-[#0a5b9c] truncate">
              {chantier.numero || 'Chantier'}
              {chantier.references ? ` · Réf. ${chantier.references}` : ''}
              {chantier.visibility === 'private' ? ' · Privé' : ' · Équipe'}
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
            onClick={onShareHtml}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-1.5 cursor-pointer"
            title="Générer une fiche HTML en consultation seule"
          >
            <Share2 className="w-4 h-4" />
            Partager (.html)
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
      </div>

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
            Créez le premier journal quotidien (N° 1) pour démarrer le suivi.
          </p>
          <button
            type="button"
            onClick={onNewJournal}
            className="mt-4 min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Créer le journal N° 1
          </button>
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
            const weekJournals = byWeek[wk];
            return (
              <section
                key={wk}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
              >
                {/* Week Header */}
                <div className="px-4 py-3 sm:px-5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      {weekRangeLabel(wk)}
                    </h2>
                    <div className="text-xs text-slate-500 tabular-nums">
                      {weekJournals.length} journal
                      {weekJournals.length > 1 ? 'aux' : ''}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPrintWeek(weekJournals)}
                      className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      Imprimer la semaine
                    </button>
                    <button
                      type="button"
                      onClick={() => onExportWeekPdf(weekJournals)}
                      className="min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileDown className="w-4 h-4" />
                      Valider la semaine (PDF)
                    </button>
                  </div>
                </div>

                {/* Daily Rows */}
                <div className="divide-y divide-slate-100">
                  {weekJournals.map((j) => {
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
                    const canDeleteJournal =
                      isAdmin ||
                      j.authorId === currentUserId ||
                      chantier.ownerId === currentUserId;

                    return (
                      <div
                        key={j.id}
                        onClick={() => onOpenJournal(j.id)}
                        className="px-4 py-3 sm:px-5 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-center justify-between gap-3 min-h-[64px]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                            <span className="text-sm font-bold text-[#0a5b9c] tabular-nums">
                              Journal N° {j.journalNum}
                            </span>
                            <span className="text-sm font-semibold text-slate-900 tabular-nums">
                              {dayNameFR(j.date)} {fmtDateFR(j.date)}
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
                        </div>

                        <div
                          className="flex items-center shrink-0 -mr-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => onDuplicateJournal(j)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-[#0a5b9c] hover:bg-slate-100 cursor-pointer"
                            title="Dupliquer vers un nouveau journal"
                            aria-label="Dupliquer le journal"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          {canDeleteJournal && (
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
