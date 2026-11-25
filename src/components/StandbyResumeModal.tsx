import { useEffect, useState } from 'react';
import { CalendarClock, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { Chantier } from '../types';
import { fmtDateFR, todayISO } from '../utils/dates';
import { addDaysISO, formatStandbyLine } from '../utils/jdtStatus';
import { uid } from '../utils/storage';

interface DraftPeriod {
  id: string;
  startDate: string;
  endDate: string;
  note: string;
}

interface StandbyResumeModalProps {
  open: boolean;
  chantier: Chantier | null;
  onClose: () => void;
  onConfirm: (params: {
    periods: DraftPeriod[];
    resumeDate: string;
    openResumeJournal: boolean;
  }) => Promise<void>;
  onCancelStandby?: () => Promise<void>;
}

export function StandbyResumeModal({
  open,
  chantier,
  onClose,
  onConfirm,
  onCancelStandby,
}: StandbyResumeModalProps) {
  const [periods, setPeriods] = useState<DraftPeriod[]>([]);
  const [resumeDate, setResumeDate] = useState(todayISO());
  const [openResumeJournal, setOpenResumeJournal] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelingStandby, setCancelingStandby] = useState(false);

  useEffect(() => {
    if (!open || !chantier) return;
    const today = todayISO();
    const start = chantier.standbySince || today;
    const defaultEnd = start < today ? addDaysISO(today, -1) : start;
    setPeriods([
      {
        id: uid(),
        startDate: start,
        endDate: defaultEnd >= start ? defaultEnd : start,
        note: '',
      },
    ]);
    setResumeDate(today >= defaultEnd ? today : addDaysISO(defaultEnd, 1));
    setOpenResumeJournal(true);
    setErrorMsg(null);
    setSubmitting(false);
    setCancelingStandby(false);
  }, [open, chantier]);

  if (!open || !chantier) return null;

  const updatePeriod = (idx: number, patch: Partial<DraftPeriod>) => {
    setPeriods((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    );
  };

  const addPeriod = () => {
    const last = periods[periods.length - 1];
    const nextBase = last?.endDate ? addDaysISO(last.endDate, 1) : todayISO();
    setPeriods((prev) => [
      ...prev,
      {
        id: uid(),
        startDate: nextBase,
        endDate: nextBase,
        note: '',
      },
    ]);
  };

  const removePeriod = (idx: number) => {
    if (periods.length <= 1) return;
    setPeriods((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    for (let i = 0; i < periods.length; i += 1) {
      const p = periods[i];
      if (!p.startDate || !p.endDate) {
        setErrorMsg(
          `Veuillez renseigner les deux dates pour le statage #${i + 1}.`
        );
        return;
      }
      if (p.endDate < p.startDate) {
        setErrorMsg(
          `La date de fin du statage #${i + 1} ne peut pas précéder la date de début.`
        );
        return;
      }
    }
    if (!resumeDate) {
      setErrorMsg('Veuillez indiquer la date de reprise du chantier.');
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onConfirm({
        periods,
        resumeDate,
        openResumeJournal,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Impossible d’enregistrer la reprise du chantier.'
      );
      setSubmitting(false);
    }
  };

  const handleCancelStandbyClick = async () => {
    if (!onCancelStandby) return;
    setErrorMsg(null);
    setCancelingStandby(true);
    try {
      await onCancelStandby();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Impossible d’annuler le statage.'
      );
      setCancelingStandby(false);
    }
  };

  const existingPeriods = chantier.standbyPeriods || [];
  const isCurrentlyStandby = chantier.jdtStatus === 'standby';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center shrink-0">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-slate-900 truncate">
                Reprise de chantier &amp; statage
              </h2>
              <p className="text-xs text-slate-500 truncate">
                {chantier.numero ? `Chantier ${chantier.numero} · ` : ''}
                {chantier.projet || 'Dossier'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 overflow-y-auto space-y-4 text-sm"
        >
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 leading-relaxed">
            Encodez la ou les périodes d&apos;arrêt (statage). À la première date
            de chaque période, le JDT inscrira automatiquement en activité{' '}
            <strong>« Chantier staté du … au … »</strong>, sautera les jours
            intermédiaires et ouvrira la page suivante au jour de reprise.
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Période(s) de statage à enregistrer
              </span>
              <button
                type="button"
                onClick={addPeriod}
                className="min-h-[34px] px-2.5 rounded-lg border border-[#0a5b9c]/40 text-[#0a5b9c] hover:bg-[#0a5b9c]/10 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter un statage
              </button>
            </div>

            {periods.map((p, idx) => (
              <div
                key={p.id}
                className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#0a5b9c]">
                    Statage #{idx + 1}
                  </span>
                  {periods.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePeriod(idx)}
                      className="min-h-[32px] min-w-[32px] rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                      aria-label="Supprimer cette période"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Du (1er jour staté)
                    </label>
                    <input
                      type="date"
                      value={p.startDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        updatePeriod(idx, {
                          startDate: val,
                          endDate: p.endDate < val ? val : p.endDate,
                        });
                      }}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Au (dernier jour staté)
                    </label>
                    <input
                      type="date"
                      value={p.endDate}
                      min={p.startDate}
                      onChange={(e) =>
                        updatePeriod(idx, { endDate: e.target.value })
                      }
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c]"
                    />
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    value={p.note}
                    onChange={(e) =>
                      updatePeriod(idx, { note: e.target.value })
                    }
                    placeholder="Motif optionnel (ex. Intempéries, Attente impétrants…)"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c]"
                  />
                </div>

                {p.startDate && p.endDate && (
                  <div className="text-[11px] font-medium text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5">
                    Mention inscrite au{' '}
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {fmtDateFR(p.startDate)}
                    </span>{' '}
                    :{' '}
                    <span className="text-[#0a5b9c] font-semibold">
                      « {formatStandbyLine(p.startDate, p.endDate, p.note)} »
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Jour de reprise du chantier
              </label>
              <input
                type="date"
                value={resumeDate}
                onChange={(e) => setResumeDate(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c]"
              />
            </div>

            <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={openResumeJournal}
                onChange={(e) => setOpenResumeJournal(e.target.checked)}
                className="w-4 h-4 accent-[#0a5b9c] rounded"
              />
              <span>
                Ouvrir directement la page du jour de reprise (
                {fmtDateFR(resumeDate)})
              </span>
            </label>
          </div>

          {existingPeriods.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Statages déjà enregistrés ({existingPeriods.length})
              </div>
              {existingPeriods.map((ep) => (
                <div
                  key={ep.id}
                  className="text-xs text-slate-700 tabular-nums"
                >
                  • {formatStandbyLine(ep.startDate, ep.endDate, ep.note)}
                </div>
              ))}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">
              {errorMsg}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
            <div>
              {isCurrentlyStandby && onCancelStandby && (
                <button
                  type="button"
                  onClick={() => void handleCancelStandbyClick()}
                  disabled={submitting || cancelingStandby}
                  className="w-full sm:w-auto min-h-[44px] px-3.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  title="Annuler la mise en stand-by et revenir à l’état actif sans créer de période de statage"
                >
                  <RotateCcw className="w-4 h-4 shrink-0" />
                  {cancelingStandby ? 'Annulation…' : 'Annuler le statage'}
                </button>
              )}
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting || cancelingStandby}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm cursor-pointer"
              >
                Fermer
              </button>
              <button
                type="submit"
                disabled={submitting || cancelingStandby}
                className="min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Play className="w-4 h-4" />
                {submitting ? 'Enregistrement…' : 'Valider et reprendre le JDT'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
