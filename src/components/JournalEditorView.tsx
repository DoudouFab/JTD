import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  CopyCheck,
  Eye,
  FileDown,
  FileEdit,
  Lock,
  Minus,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  ETATS,
  LINE_SECTIONS,
  type Chantier,
  type Journal,
  type JournalLineField,
  type Ouvrier,
} from '../types';
import { dayNameFR } from '../utils/dates';
import { A4JournalSheet } from './A4JournalSheet';
import { AutocompleteInput } from './AutocompleteInput';

interface JournalEditorViewProps {
  chantier: Chantier;
  journal: Journal;
  previousJournal: Journal | null;
  isOwner: boolean;
  isInCompletedWeek: boolean;
  firmSuggestions: string[];
  travauxSuggestions: string[];
  onChange: (updated: Journal) => void;
  onToggleStatus: (nextStatus: 'in_progress' | 'completed') => void;
  onSignPage: (role: 'controleur' | 'lecteur') => void;
  onBack: () => void;
  onPrintSingle: () => void;
  onExportDayPdf: () => void;
  onNotify: (msg: string, tone?: 'default' | 'success' | 'error') => void;
}

export function JournalEditorView({
  chantier,
  journal,
  previousJournal,
  isOwner,
  isInCompletedWeek,
  firmSuggestions,
  travauxSuggestions,
  onChange,
  onToggleStatus,
  onSignPage,
  onBack,
  onPrintSingle,
  onExportDayPdf,
  onNotify,
}: JournalEditorViewProps) {
  const [mobileTab, setMobileTab] = useState<'form' | 'preview'>(
    isOwner ? 'form' : 'preview'
  );
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = useState(0.58);

  const isCompleted = journal.status === 'completed';
  const isSignedCtrl = Boolean(journal.signatureControleur);
  const isSignedReader = Boolean(journal.signatureLecteur);
  const isSignedAny = isSignedCtrl || isSignedReader;
  const readOnly = !isOwner || isSignedAny;
  const currentRole: 'controleur' | 'lecteur' = isOwner
    ? 'controleur'
    : 'lecteur';
  const needsMySignature =
    isInCompletedWeek &&
    (currentRole === 'controleur' ? !isSignedCtrl : !isSignedReader);

  // Measure live preview container to scale the 210mm (~794px) A4 sheet cleanly
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;

    const updateScale = () => {
      const w = el.clientWidth;
      if (w > 0) {
        setPreviewScale(Math.min(0.85, (w - 16) / 794));
      }
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mobileTab]);

  const totalOuvriers = useMemo(
    () =>
      (journal.ouvriers || []).reduce(
        (sum, o) => sum + (Number(o.nbre) || 0),
        0
      ),
    [journal.ouvriers]
  );

  const updateField = <K extends keyof Journal>(key: K, val: Journal[K]) => {
    if (readOnly) return;
    onChange({ ...journal, [key]: val });
  };

  const toggleEtat = (etat: string) => {
    if (readOnly) return;
    const exists = journal.etatAtmo.includes(etat);
    const next = exists
      ? journal.etatAtmo.filter((e) => e !== etat)
      : [...journal.etatAtmo, etat];
    updateField('etatAtmo', next);
  };

  const updateOuvrier = (idx: number, patch: Partial<Ouvrier>) => {
    if (readOnly) return;
    const next = journal.ouvriers.map((o, i) =>
      i === idx ? { ...o, ...patch } : o
    );
    updateField('ouvriers', next);
  };

  const addOuvrier = () => {
    if (readOnly) return;
    updateField('ouvriers', [
      ...journal.ouvriers,
      { firme: '', metier: '', nbre: 1 },
    ]);
  };

  const removeOuvrier = (idx: number) => {
    if (readOnly) return;
    if (journal.ouvriers.length <= 1) {
      updateField('ouvriers', [{ firme: '', metier: '', nbre: 1 }]);
      return;
    }
    updateField(
      'ouvriers',
      journal.ouvriers.filter((_, i) => i !== idx)
    );
  };

  const updateLine = (field: JournalLineField, idx: number, val: string) => {
    if (readOnly) return;
    const arr = [...(journal[field] || [])];
    arr[idx] = val;
    updateField(field, arr);
  };

  const addLine = (field: JournalLineField) => {
    if (readOnly) return;
    const arr = [...(journal[field] || []), ''];
    updateField(field, arr);
  };

  const removeLine = (field: JournalLineField, idx: number) => {
    if (readOnly) return;
    const arr = (journal[field] || []).filter((_, i) => i !== idx);
    updateField(field, arr);
  };

  const copyPrevWorkers = () => {
    if (readOnly || !previousJournal) return;
    const valid = previousJournal.ouvriers.filter(
      (o) => o.firme || o.metier || o.nbre > 0
    );
    if (!valid.length) {
      onNotify("Aucune équipe renseignée dans le journal précédent.");
      return;
    }
    updateField(
      'ouvriers',
      valid.map((o) => ({ ...o }))
    );
    onNotify(
      `Équipe reprise depuis le Journal N° ${previousJournal.journalNum}.`,
      'success'
    );
  };

  const copyPrevMateriel = () => {
    if (readOnly || !previousJournal) return;
    const valid = previousJournal.materiel.map((x) => x.trim()).filter(Boolean);
    if (!valid.length) {
      onNotify("Aucun matériel renseigné dans le journal précédent.");
      return;
    }
    updateField('materiel', [...valid]);
    onNotify(
      `Matériel repris depuis le Journal N° ${previousJournal.journalNum}.`,
      'success'
    );
  };

  return (
    <div className="space-y-4 pb-20 lg:pb-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour</span>
          </button>
          <div className="min-w-0">
            <div className="text-xs font-mono font-semibold text-[#0a5b9c] truncate flex items-center gap-2">
              <span>
                {chantier.numero || 'Chantier'} · Journal N°{' '}
                <span className="tabular-nums">{journal.journalNum}</span>
              </span>
              <span
                className={`font-sans text-[11px] font-bold px-2 py-0.5 rounded-md ${
                  isCompleted
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isCompleted ? 'Page terminée' : 'Page en cours'}
              </span>
            </div>
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900 truncate">
              {chantier.projet || 'Journal des travaux'}
            </h1>
          </div>
        </div>

        {/* Desktop Actions */}
        <div className="hidden lg:flex items-center gap-2.5 shrink-0">
          {isOwner && !isSignedAny && (
            <button
              type="button"
              onClick={() =>
                onToggleStatus(isCompleted ? 'in_progress' : 'completed')
              }
              className={`min-h-[44px] px-4 rounded-xl border font-semibold text-sm flex items-center gap-2 cursor-pointer transition-colors ${
                isCompleted
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
              }`}
            >
              {isCompleted ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Terminée (repasser en cours)
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  Marquer page terminée
                </>
              )}
            </button>
          )}

          {needsMySignature && (
            <button
              type="button"
              onClick={() => onSignPage(currentRole)}
              className="min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              Signer cette page (itsme® / eID)
            </button>
          )}

          {isOwner && (
            <>
              <button
                type="button"
                onClick={onPrintSingle}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Imprimer
              </button>
              <button
                type="button"
                onClick={onExportDayPdf}
                className="min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm flex items-center gap-2 shadow-xs cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                PDF jour
              </button>
            </>
          )}
        </div>
      </div>

      {/* Read-only / Locked Notice */}
      {readOnly && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 flex items-center gap-3 text-xs text-amber-950">
          <Lock className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            {!isOwner
              ? 'Consultation en lecture seule (accès temporaire sur ce dossier).'
              : 'Cette page a reçu au moins une signature authentifiée et est verrouillée en modification pour garantir son intégrité.'}
          </span>
        </div>
      )}

      {/* Mobile View Switcher (Form vs Live A4 Preview) */}
      <div className="lg:hidden grid grid-cols-2 p-1 rounded-xl bg-slate-200/75 border border-slate-200">
        <button
          type="button"
          onClick={() => setMobileTab('form')}
          className={`min-h-[44px] rounded-lg text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
            mobileTab === 'form'
              ? 'bg-white text-[#0a5b9c] shadow-xs'
              : 'text-slate-600'
          }`}
        >
          <FileEdit className="w-4 h-4" />
          {readOnly ? 'Détails & signatures' : 'Saisie terrain'}
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('preview')}
          className={`min-h-[44px] rounded-lg text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
            mobileTab === 'preview'
              ? 'bg-white text-[#0a5b9c] shadow-xs'
              : 'text-slate-600'
          }`}
        >
          <Eye className="w-4 h-4" />
          Aperçu A4
        </button>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Column */}
        <div
          className={`lg:col-span-7 space-y-4 ${
            mobileTab === 'preview' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Carry-over Helper */}
          {!readOnly && previousJournal && (
            <div className="rounded-2xl border border-[#0a5b9c]/25 bg-[#0a5b9c]/[0.04] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-700">
                Reprise rapide depuis le Journal N°{' '}
                <span className="tabular-nums font-bold text-[#0a5b9c]">
                  {previousJournal.journalNum}
                </span>{' '}
                :
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyPrevWorkers}
                  className="min-h-[38px] px-3 rounded-lg bg-white border border-slate-200 hover:border-[#0a5b9c] text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <CopyCheck className="w-3.5 h-3.5 text-[#0a5b9c]" />
                  Reprendre équipe (A)
                </button>
                <button
                  type="button"
                  onClick={copyPrevMateriel}
                  className="min-h-[38px] px-3 rounded-lg bg-white border border-slate-200 hover:border-[#0a5b9c] text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <CopyCheck className="w-3.5 h-3.5 text-[#0a5b9c]" />
                  Reprendre matériel (C)
                </button>
              </div>
            </div>
          )}

          {/* Identification & Weather Card */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#0a5b9c]">
              En-tête &amp; Conditions météo
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Journal N°
                </label>
                <input
                  type="number"
                  min={1}
                  disabled={readOnly}
                  value={journal.journalNum}
                  onChange={(e) =>
                    updateField(
                      'journalNum',
                      Math.max(1, parseInt(e.target.value, 10) || 1)
                    )
                  }
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Date ({dayNameFR(journal.date) || '—'})
                </label>
                <input
                  type="date"
                  disabled={readOnly}
                  value={journal.date}
                  onChange={(e) => updateField('date', e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Début
                </label>
                <input
                  type="time"
                  disabled={readOnly}
                  value={journal.horaireDebut}
                  onChange={(e) => updateField('horaireDebut', e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Fin
                </label>
                <input
                  type="time"
                  disabled={readOnly}
                  value={journal.horaireFin}
                  onChange={(e) => updateField('horaireFin', e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  T° 8h00 (°C)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={readOnly}
                  value={journal.tempMatin}
                  onChange={(e) => updateField('tempMatin', e.target.value)}
                  placeholder="ex. 6"
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  T° 16h15 (°C)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={readOnly}
                  value={journal.tempApresMidi}
                  onChange={(e) => updateField('tempApresMidi', e.target.value)}
                  placeholder="ex. 14"
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">
                État atmosphérique
              </div>
              <div className="flex flex-wrap gap-2">
                {ETATS.map((etat) => {
                  const active = journal.etatAtmo.includes(etat);
                  return (
                    <button
                      key={etat}
                      type="button"
                      disabled={readOnly}
                      onClick={() => toggleEtat(etat)}
                      aria-pressed={active}
                      className={`min-h-[40px] px-3 rounded-xl border text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                        readOnly ? 'cursor-default opacity-80' : 'cursor-pointer'
                      } ${
                        active
                          ? 'bg-[#0a5b9c] border-[#0a5b9c] text-white'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-sm flex items-center justify-center border ${
                          active
                            ? 'bg-white text-[#0a5b9c] border-white'
                            : 'border-slate-300'
                        }`}
                      >
                        {active && <Check className="w-3 h-3 stroke-[3]" />}
                      </span>
                      {etat}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Section A: Ouvriers */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                <span className="text-[#0a5b9c] font-mono mr-1.5">A.</span>
                Ouvriers
              </h2>
              <span className="text-xs font-bold text-slate-700 tabular-nums">
                Total présent :{' '}
                <span className="text-[#0a5b9c] text-sm">{totalOuvriers}</span>
              </span>
            </div>

            <div className="space-y-3">
              {journal.ouvriers.map((o, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <AutocompleteInput
                      value={o.firme}
                      disabled={readOnly}
                      onChange={(val) => updateOuvrier(idx, { firme: val })}
                      suggestions={firmSuggestions}
                      placeholder="Firme (ex. Entreprise générale…)"
                    />
                    <input
                      type="text"
                      disabled={readOnly}
                      value={o.metier}
                      onChange={(e) =>
                        updateOuvrier(idx, { metier: e.target.value })
                      }
                      placeholder="Métier / Qualification"
                      className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-500 mr-1">
                        Nombre :
                      </span>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            updateOuvrier(idx, {
                              nbre: Math.max(0, (Number(o.nbre) || 0) - 1),
                            })
                          }
                          className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                          aria-label="Diminuer le nombre"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                      )}
                      <input
                        type="number"
                        min={0}
                        disabled={readOnly}
                        value={o.nbre}
                        onChange={(e) =>
                          updateOuvrier(idx, {
                            nbre: Math.max(0, parseInt(e.target.value, 10) || 0),
                          })
                        }
                        className="w-16 min-h-[44px] px-2 rounded-xl border border-slate-200 bg-white text-center text-sm font-bold text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            updateOuvrier(idx, {
                              nbre: (Number(o.nbre) || 0) + 1,
                            })
                          }
                          className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                          aria-label="Augmenter le nombre"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeOuvrier(idx)}
                        className="min-h-[44px] min-w-[44px] rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                        aria-label="Supprimer cette ligne ouvrier"
                        title="Supprimer cette ligne"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {!readOnly && (
              <button
                type="button"
                onClick={addOuvrier}
                className="w-full min-h-[44px] rounded-xl border border-dashed border-slate-300 hover:border-[#0a5b9c] hover:text-[#0a5b9c] text-slate-600 text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                Ajouter une ligne ouvrier
              </button>
            )}
          </section>

          {/* Sections B, C, E, F, H, J, K */}
          {LINE_SECTIONS.map((sec) => {
            const items = journal[sec.key] || [];
            const nonEmptyCount = items.filter((x) => x.trim()).length;

            return (
              <section
                key={sec.key}
                className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900">
                    <span className="text-[#0a5b9c] font-mono mr-1.5">
                      {sec.code}.
                    </span>
                    {sec.label}
                  </h2>
                  {nonEmptyCount > 0 && (
                    <span className="text-xs font-semibold text-slate-500 tabular-nums">
                      {nonEmptyCount} entrée{nonEmptyCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {items.length > 0 && (
                  <div className="space-y-2.5">
                    {items.map((line, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        {sec.key === 'travaux' ? (
                          <AutocompleteInput
                            multiline
                            rows={2}
                            disabled={readOnly}
                            value={line}
                            onChange={(val) => updateLine(sec.key, idx, val)}
                            suggestions={travauxSuggestions}
                            placeholder={sec.placeholder}
                          />
                        ) : (
                          <textarea
                            rows={2}
                            disabled={readOnly}
                            value={line}
                            onChange={(e) =>
                              updateLine(sec.key, idx, e.target.value)
                            }
                            placeholder={sec.placeholder}
                            className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15 resize-y disabled:bg-slate-50 disabled:text-slate-600"
                          />
                        )}
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => removeLine(sec.key, idx)}
                            className="min-h-[44px] min-w-[44px] rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center shrink-0 cursor-pointer"
                            aria-label="Supprimer cette ligne"
                            title="Supprimer cette ligne"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => addLine(sec.key)}
                    className="w-full min-h-[44px] rounded-xl border border-dashed border-slate-300 hover:border-[#0a5b9c] hover:text-[#0a5b9c] text-slate-600 text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter une ligne ({sec.code})
                  </button>
                )}
              </section>
            );
          })}

          {/* Signatures & Authenticated Verification */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                Signatures &amp; authentification (itsme® / eID)
              </h2>
              {needsMySignature && (
                <button
                  type="button"
                  onClick={() => onSignPage(currentRole)}
                  className="min-h-[38px] px-3.5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Signer cette page
                </button>
              )}
            </div>

            {!isInCompletedWeek && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                La signature authentifiée par page est activée dès que toutes
                les pages de cette semaine sont marquées comme{' '}
                <strong>Page terminée</strong>.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Contrôleur */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
                <div className="text-xs font-semibold text-slate-500">
                  Contrôleur responsable (INASEP)
                </div>
                <div className="text-sm font-bold text-slate-900">
                  {journal.signatureControleur?.signerName ||
                    chantier.preposeSurveillance ||
                    'Non défini'}
                </div>
                {journal.signatureControleur ? (
                  <div className="text-[11px] text-emerald-700 space-y-0.5">
                    <div className="font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Signé via{' '}
                      {journal.signatureControleur.method === 'itsme'
                        ? 'itsme®'
                        : 'Carte eID'}
                    </div>
                    <div className="font-mono text-[10px] text-slate-600 truncate">
                      Réf. {journal.signatureControleur.verificationId}
                    </div>
                    <div className="text-[10px] text-slate-500 tabular-nums">
                      Le{' '}
                      {new Date(
                        journal.signatureControleur.signedAt
                      ).toLocaleString('fr-BE')}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    En attente de signature
                  </div>
                )}
              </div>

              {/* Entrepreneur / Lecteur */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
                <div className="text-xs font-semibold text-slate-500">
                  Entrepreneur / Lecteur autorisé
                </div>
                <input
                  type="text"
                  disabled={readOnly}
                  value={journal.sigEntrepreneur}
                  onChange={(e) =>
                    updateField('sigEntrepreneur', e.target.value)
                  }
                  placeholder="Nom du responsable entrepreneur"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-100 disabled:text-slate-600"
                />
                {journal.signatureLecteur ? (
                  <div className="text-[11px] text-emerald-700 space-y-0.5">
                    <div className="font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Signé par {journal.signatureLecteur.signerName} (
                      {journal.signatureLecteur.method === 'itsme'
                        ? 'itsme®'
                        : 'Carte eID'}
                      )
                    </div>
                    <div className="font-mono text-[10px] text-slate-600 truncate">
                      Réf. {journal.signatureLecteur.verificationId}
                    </div>
                    <div className="text-[10px] text-slate-500 tabular-nums">
                      Le{' '}
                      {new Date(
                        journal.signatureLecteur.signedAt
                      ).toLocaleString('fr-BE')}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    En attente de signature du lecteur temporaire
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Live A4 Sheet Preview Column */}
        <div
          className={`lg:col-span-5 lg:sticky lg:top-20 ${
            mobileTab === 'form' ? 'hidden lg:block' : 'block'
          }`}
        >
          <div className="rounded-2xl border border-slate-200 bg-slate-200/70 p-3">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Aperçu feuille A4 en direct
              </span>
              <span className="text-xs text-slate-500 tabular-nums">
                {Math.round(previewScale * 100)}%
              </span>
            </div>

            <div
              ref={previewWrapRef}
              className="w-full overflow-hidden flex justify-center rounded-xl bg-slate-300/60 p-2"
            >
              <div
                style={{
                  width: `${794 * previewScale}px`,
                  height: `${1123 * previewScale}px`,
                }}
                className="relative shrink-0 shadow-md bg-white overflow-hidden"
              >
                <div
                  style={{
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top left',
                    width: '794px',
                  }}
                >
                  <A4JournalSheet chantier={chantier} journal={journal} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky Bottom Action Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2.5 flex items-center gap-2">
        {isOwner && !isSignedAny && (
          <button
            type="button"
            onClick={() =>
              onToggleStatus(isCompleted ? 'in_progress' : 'completed')
            }
            className={`min-h-[44px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
              isCompleted
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-amber-300 bg-amber-50 text-amber-900'
            }`}
          >
            {isCompleted ? 'Terminée ✓' : 'Terminer'}
          </button>
        )}

        {needsMySignature && (
          <button
            type="button"
            onClick={() => onSignPage(currentRole)}
            className="flex-1 min-h-[44px] px-3 rounded-xl bg-[#0a5b9c] text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            Signer (itsme®/eID)
          </button>
        )}

        {isOwner && (
          <>
            <button
              type="button"
              onClick={onPrintSingle}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onExportDayPdf}
              className="flex-1 min-h-[44px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
              PDF jour
            </button>
          </>
        )}
      </div>
    </div>
  );
}
