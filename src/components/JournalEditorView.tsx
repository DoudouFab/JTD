import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  CopyCheck,
  Eye,
  FileDown,
  FileEdit,
  Lock,
  Minus,
  Plus,
  Printer,
  ShieldCheck,
  SpellCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ETATS,
  LINE_SECTIONS,
  STANDARD_TRAVAUX_PRESETS,
  type Chantier,
  type Journal,
  type JournalLineField,
  type Ouvrier,
} from '../types';
import { dayNameFR, fmtDateFR, getChantierDisplayTitle } from '../utils/dates';
import { formatJournalDateTabLabel } from '../utils/jdtStatus';
import {
  addWordToCustomDictionary,
  checkJournalSpelling,
  loadCustomDictionary,
  type SpellIssue,
} from '../utils/frenchSpellcheck';
import {
  formatSignatureMethodLabel,
  verifyJournalSignatureRecord,
  type SignatureVerificationResult,
} from '../utils/signatureCrypto';
import { A4JournalSheet } from './A4JournalSheet';
import { AutocompleteInput } from './AutocompleteInput';

interface JournalEditorViewProps {
  chantier: Chantier;
  journal: Journal;
  allJournals?: Journal[];
  previousJournal: Journal | null;
  isOwner: boolean;
  isDelegate?: boolean;
  currentUserId?: string;
  firmSuggestions: string[];
  travauxSuggestions: string[];
  onSelectJournal?: (journalId: string) => void;
  onChange: (updated: Journal) => void;
  onToggleStatus: (nextStatus: 'in_progress' | 'completed') => void;
  onSignPage: (role: 'controleur' | 'lecteur') => void;
  onBack: () => void;
  onPrintSingle: () => void;
  onExportDayPdf: () => void;
  onNotify: (msg: string, tone?: 'default' | 'success' | 'error') => void;
}

const PRIMARY_LINE_KEYS = new Set<JournalLineField>(['travaux', 'materiel']);

export function JournalEditorView({
  chantier,
  journal,
  allJournals = [],
  previousJournal,
  isOwner,
  isDelegate = false,
  currentUserId = '',
  firmSuggestions,
  travauxSuggestions,
  onSelectJournal,
  onChange,
  onToggleStatus,
  onSignPage,
  onBack,
  onPrintSingle,
  onExportDayPdf,
  onNotify,
}: JournalEditorViewProps) {
  const canAuthorRole = isOwner || isDelegate;
  const [mobileTab, setMobileTab] = useState<'form' | 'preview'>(
    canAuthorRole ? 'form' : 'preview'
  );
  const [spellOpen, setSpellOpen] = useState(false);
  const [customDict, setCustomDict] = useState<Set<string>>(() =>
    loadCustomDictionary()
  );
  const [expandedSecondary, setExpandedSecondary] = useState<
    Record<string, boolean>
  >({});
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = useState(0.58);

  const isCompleted = journal.status === 'completed';
  const isSignedCtrl = Boolean(journal.signatureControleur);
  const isSignedReader = Boolean(journal.signatureLecteur);
  const isSignedAny = isSignedCtrl || isSignedReader;
  const delegateLocked = isDelegate && isCompleted;
  const readOnly = !canAuthorRole || isSignedAny || delegateLocked;
  const currentRole: 'controleur' | 'lecteur' = canAuthorRole
    ? 'controleur'
    : 'lecteur';
  const canMarkCompleted = canAuthorRole && !isSignedAny && !isCompleted;
  const canReopenToInProgress = isOwner && !isSignedAny && isCompleted;
  const needsMySignature =
    isCompleted &&
    (currentRole === 'controleur'
      ? !isSignedCtrl && (isOwner || journal.authorId === currentUserId)
      : !isSignedReader);

  const spellIssues = useMemo(
    () => (readOnly ? [] : checkJournalSpelling(journal, customDict)),
    [journal, customDict, readOnly]
  );

  const [ctrlVerify, setCtrlVerify] =
    useState<SignatureVerificationResult | null>(null);
  const [lectVerify, setLectVerify] =
    useState<SignatureVerificationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (journal.signatureControleur) {
        const res = await verifyJournalSignatureRecord(
          chantier,
          journal,
          journal.signatureControleur
        );
        if (!cancelled) setCtrlVerify(res);
      } else if (!cancelled) {
        setCtrlVerify(null);
      }
      if (journal.signatureLecteur) {
        const res = await verifyJournalSignatureRecord(
          chantier,
          journal,
          journal.signatureLecteur
        );
        if (!cancelled) setLectVerify(res);
      } else if (!cancelled) {
        setLectVerify(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [chantier, journal]);

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

  const validWorkersCount = useMemo(
    () =>
      (journal.ouvriers || []).filter(
        (o) => o.firme.trim() || o.metier.trim() || (Number(o.nbre) || 0) > 0
      ).length,
    [journal.ouvriers]
  );

  const weatherFilled = useMemo(
    () =>
      Boolean(
        journal.etatAtmo.length > 0 ||
          journal.tempMatin.trim() ||
          journal.tempApresMidi.trim()
      ),
    [journal.etatAtmo, journal.tempMatin, journal.tempApresMidi]
  );

  const travauxCount = useMemo(
    () => (journal.travaux || []).filter((x) => x.trim()).length,
    [journal.travaux]
  );

  const updateField = <K extends keyof Journal>(key: K, val: Journal[K]) => {
    if (readOnly) return;
    onChange({ ...journal, [key]: val });
  };

  const etatPresetSet = useMemo(() => new Set<string>(ETATS), []);
  const customEtatNote = useMemo(
    () =>
      (journal.etatAtmo || []).find((item) => !etatPresetSet.has(item)) || '',
    [journal.etatAtmo, etatPresetSet]
  );

  const toggleEtat = (etat: string) => {
    if (readOnly) return;
    const exists = journal.etatAtmo.includes(etat);
    const next = exists
      ? journal.etatAtmo.filter((e) => e !== etat)
      : [...journal.etatAtmo, etat];
    updateField('etatAtmo', next);
  };

  const updateCustomEtatNote = (val: string) => {
    if (readOnly) return;
    const presetOnly = (journal.etatAtmo || []).filter((item) =>
      etatPresetSet.has(item)
    );
    const cleaned = val.trimStart();
    updateField(
      'etatAtmo',
      cleaned.trim() ? [...presetOnly, cleaned] : presetOnly
    );
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
    setExpandedSecondary((prev) => ({ ...prev, [field]: true }));
  };

  const removeLine = (field: JournalLineField, idx: number) => {
    if (readOnly) return;
    const arr = (journal[field] || []).filter((_, i) => i !== idx);
    updateField(field, arr);
  };

  const insertPresetTravaux = (label: string) => {
    if (readOnly) return;
    const current = [...(journal.travaux || [])];
    if (current.some((x) => x.trim().toLowerCase() === label.toLowerCase())) {
      onNotify(`« ${label} » est déjà présent dans la section B.`);
      return;
    }
    const emptyIdx = current.findIndex((x) => !x.trim());
    if (emptyIdx >= 0) {
      current[emptyIdx] = label;
    } else {
      current.push(label);
    }
    updateField('travaux', current);
  };

  const copyPrevWorkers = () => {
    if (readOnly || !previousJournal) return;
    const valid = previousJournal.ouvriers.filter(
      (o) => o.firme.trim() || o.metier.trim() || o.nbre > 0
    );
    if (!valid.length) {
      onNotify('Aucune présence ouvrière renseignée dans le journal précédent.');
      return;
    }
    updateField(
      'ouvriers',
      valid.map((o) => ({ ...o }))
    );
    onNotify(
      `Présences de la veille reprises (Journal N° ${previousJournal.journalNum}).`,
      'success'
    );
  };

  const copyPrevActivities = () => {
    if (readOnly || !previousJournal) return;
    const valid = (previousJournal.travaux || [])
      .map((x) => x.trim())
      .filter(Boolean);
    if (!valid.length) {
      onNotify('Aucune activité renseignée dans le journal précédent.');
      return;
    }
    updateField('travaux', [...valid]);
    onNotify(
      `Activités de la veille dupliquées (Journal N° ${previousJournal.journalNum}).`,
      'success'
    );
  };

  const copyPrevMateriel = () => {
    if (readOnly || !previousJournal) return;
    const valid = previousJournal.materiel.map((x) => x.trim()).filter(Boolean);
    if (!valid.length) {
      onNotify('Aucun matériel renseigné dans le journal précédent.');
      return;
    }
    updateField('materiel', [...valid]);
    onNotify(
      `Matériel repris depuis le Journal N° ${previousJournal.journalNum}.`,
      'success'
    );
  };

  const jumpToSection = (sectionId: string, expandField?: JournalLineField) => {
    setMobileTab('form');
    if (expandField) {
      setExpandedSecondary((prev) => ({ ...prev, [expandField]: true }));
    }
    window.setTimeout(() => {
      const el = document.getElementById(sectionId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  };

  const applySingleIssueOnJournal = (base: Journal, issue: SpellIssue): Journal => {
    if (issue.target.kind === 'etatNote') {
      const presetOnly = (base.etatAtmo || []).filter((item) =>
        etatPresetSet.has(item)
      );
      const currentNote =
        (base.etatAtmo || []).find((item) => !etatPresetSet.has(item)) || '';
      const fixedNote = issue.apply(currentNote);
      return {
        ...base,
        etatAtmo: fixedNote.trim() ? [...presetOnly, fixedNote] : presetOnly,
      };
    }

    if (issue.target.kind === 'ouvrierMetier') {
      const idx = issue.target.index;
      return {
        ...base,
        ouvriers: base.ouvriers.map((o, i) =>
          i === idx ? { ...o, metier: issue.apply(o.metier || '') } : o
        ),
      };
    }

    const { field, index } = issue.target;
    const arr = [...(base[field] || [])];
    if (index >= 0 && index < arr.length) {
      arr[index] = issue.apply(arr[index] || '');
    }
    return { ...base, [field]: arr };
  };

  const handleApplySpellIssue = (issue: SpellIssue) => {
    if (readOnly) return;
    onChange(applySingleIssueOnJournal(journal, issue));
    onNotify(`Corrigé : « ${issue.suggestion} »`, 'success');
  };

  const handleApplyAllSpellIssues = () => {
    if (readOnly || !spellIssues.length) return;
    let next = journal;
    for (const issue of spellIssues) {
      next = applySingleIssueOnJournal(next, issue);
    }
    onChange(next);
    onNotify(
      `${spellIssues.length} correction${spellIssues.length > 1 ? 's' : ''} appliquée${spellIssues.length > 1 ? 's' : ''}.`,
      'success'
    );
  };

  const handleIgnoreSpellWord = (word: string) => {
    const updated = addWordToCustomDictionary(word);
    setCustomDict(updated);
    onNotify(`« ${word} » ajouté à votre dictionnaire personnel.`);
  };

  const prevWorkersCount = previousJournal
    ? previousJournal.ouvriers.filter(
        (o) => o.firme.trim() || o.metier.trim() || o.nbre > 0
      ).length
    : 0;
  const prevActivitiesCount = previousJournal
    ? (previousJournal.travaux || []).filter((x) => x.trim()).length
    : 0;

  return (
    <div className="space-y-3.5 pb-20 lg:pb-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[42px] min-w-[42px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Retour</span>
          </button>
          <div className="min-w-0">
            <div className="text-xs font-mono font-semibold text-[#0a5b9c] truncate flex items-center gap-2">
              <span className="tabular-nums">
                {chantier.numero || 'Chantier'} · {formatJournalDateTabLabel(journal)} · N°{' '}
                {journal.journalNum}
              </span>
              <span
                className={`font-sans text-[11px] font-bold px-2 py-0.5 rounded-md ${
                  isCompleted
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isCompleted ? 'Terminée ✓' : 'En cours'}
              </span>
            </div>
            <h1 className="text-base sm:text-lg font-black text-slate-900 truncate">
              {getChantierDisplayTitle(chantier)}
            </h1>
          </div>
        </div>

        {/* Desktop Actions */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                setSpellOpen((v) => !v);
                setMobileTab('form');
              }}
              className={`min-h-[42px] px-3.5 rounded-xl border font-semibold text-sm flex items-center gap-2 cursor-pointer transition-colors ${
                spellIssues.length > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
              title="Vérifier l'orthographe française de la page"
            >
              <SpellCheck className="w-4 h-4 text-[#0a5b9c]" />
              <span>
                Orthographe
                {spellIssues.length > 0 ? ` (${spellIssues.length})` : ' ✓'}
              </span>
            </button>
          )}

          {(canMarkCompleted || canReopenToInProgress) && (
            <button
              type="button"
              onClick={() =>
                onToggleStatus(isCompleted ? 'in_progress' : 'completed')
              }
              className={`min-h-[42px] px-4 rounded-xl border font-semibold text-sm flex items-center gap-2 cursor-pointer transition-colors ${
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
              className="min-h-[42px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              Signer cette page (e-ID)
            </button>
          )}

          {canAuthorRole && (
            <>
              <button
                type="button"
                onClick={onPrintSingle}
                className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Imprimer
              </button>
              <button
                type="button"
                onClick={onExportDayPdf}
                className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm flex items-center gap-2 shadow-xs cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                PDF jour
              </button>
            </>
          )}
        </div>
      </div>

      {/* Horizontal Date Tabs (JJ/MM/AA) across pages in this dossier */}
      {allJournals.length > 0 && onSelectJournal && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {[...allJournals]
            .sort(
              (a, b) =>
                (a.date || '').localeCompare(b.date || '') ||
                a.journalNum - b.journalNum
            )
            .map((j) => {
              const isCurrent = j.id === journal.id;
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => onSelectJournal(j.id)}
                  title={`Journal N° ${j.journalNum} · ${fmtDateFR(j.date)}`}
                  className={`min-h-[34px] px-3 rounded-lg border text-xs font-bold whitespace-nowrap shrink-0 tabular-nums cursor-pointer transition-colors ${
                    isCurrent
                      ? 'border-[#0a5b9c] bg-[#0a5b9c] text-white shadow-xs'
                      : j.status === 'completed'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-[#0a5b9c]/50'
                  }`}
                >
                  {formatJournalDateTabLabel(j)}
                </button>
              );
            })}
        </div>
      )}

      {/* Read-only / Locked Notice */}
      {readOnly && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 flex items-center gap-3 text-xs text-amber-950">
          <Lock className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            {delegateLocked
              ? 'Page terminée et verrouillée : en tant que rédacteur remplaçant, vous ne pouvez plus modifier une page déjà validée (vous pouvez uniquement signer celles que vous avez rédigées).'
              : !canAuthorRole
                ? isSignedAny
                  ? 'Consultation en lecture seule · Cette page a reçu une signature authentifiée et est définitivement verrouillée.'
                  : 'Consultation en lecture seule (accès temporaire sur ce dossier uniquement).'
                : 'Cette page a reçu au moins une signature authentifiée et est définitivement verrouillée en modification.'}
          </span>
        </div>
      )}

      {/* Mobile View Switcher (Form vs Live A4 Preview) */}
      <div className="lg:hidden grid grid-cols-2 p-1 rounded-xl bg-slate-200/75 border border-slate-200">
        <button
          type="button"
          onClick={() => setMobileTab('form')}
          className={`min-h-[42px] rounded-lg text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
            mobileTab === 'form'
              ? 'bg-white text-[#0a5b9c] shadow-xs'
              : 'text-slate-600'
          }`}
        >
          <FileEdit className="w-4 h-4" />
          {readOnly ? 'Détails & signatures' : 'Saisie rapide'}
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('preview')}
          className={`min-h-[42px] rounded-lg text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Form Column */}
        <div
          className={`lg:col-span-7 space-y-3.5 ${
            mobileTab === 'preview' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Fast GSM Jump Strip */}
          {!readOnly && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => jumpToSection('sec-meteo')}
                className={`min-h-[34px] px-3 rounded-xl border text-xs font-bold whitespace-nowrap cursor-pointer shrink-0 ${
                  weatherFilled
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                {weatherFilled ? '✓ Météo' : '• Météo'}
              </button>
              <button
                type="button"
                onClick={() => jumpToSection('sec-ouvriers')}
                className={`min-h-[34px] px-3 rounded-xl border text-xs font-bold whitespace-nowrap cursor-pointer shrink-0 ${
                  totalOuvriers > 0
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                {totalOuvriers > 0
                  ? `✓ A · Ouvriers (${totalOuvriers})`
                  : '• A · Ouvriers'}
              </button>
              <button
                type="button"
                onClick={() => jumpToSection('sec-travaux')}
                className={`min-h-[34px] px-3 rounded-xl border text-xs font-bold whitespace-nowrap cursor-pointer shrink-0 ${
                  travauxCount > 0
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                {travauxCount > 0
                  ? `✓ B · Activités (${travauxCount})`
                  : '• B · Activités'}
              </button>
              <button
                type="button"
                onClick={() => jumpToSection('sec-materiel')}
                className="min-h-[34px] px-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold whitespace-nowrap cursor-pointer shrink-0"
              >
                C · Matériel
              </button>
              <button
                type="button"
                onClick={() => jumpToSection('sec-signatures')}
                className="min-h-[34px] px-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold whitespace-nowrap cursor-pointer shrink-0"
              >
                Signatures
              </button>
              <button
                type="button"
                onClick={() => setSpellOpen((v) => !v)}
                className={`lg:hidden min-h-[34px] px-3 rounded-xl border text-xs font-bold whitespace-nowrap cursor-pointer shrink-0 flex items-center gap-1 ${
                  spellIssues.length > 0
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                <SpellCheck className="w-3.5 h-3.5" />
                {spellIssues.length > 0 ? `Fautes (${spellIssues.length})` : 'Ortho ✓'}
              </button>
            </div>
          )}

          {/* Integrated French & Chantier Spellchecker Panel */}
          {!readOnly && spellOpen && (
            <section className="rounded-2xl border border-[#0a5b9c]/30 bg-white p-4 space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <SpellCheck className="w-4 h-4 text-[#0a5b9c]" />
                  <h2 className="text-sm font-bold text-slate-900">
                    Correcteur d&apos;orthographe français
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {spellIssues.length > 0 && (
                    <button
                      type="button"
                      onClick={handleApplyAllSpellIssues}
                      className="min-h-[34px] px-3 rounded-lg bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      Tout corriger ({spellIssues.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSpellOpen(false)}
                    className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                    aria-label="Fermer le correcteur"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {spellIssues.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    Aucune faute détectée dans les textes saisis.
                  </span>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                  {spellIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="p-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="font-bold text-[#0a5b9c]">
                            {issue.sectionLabel}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-500">{issue.reason}</span>
                        </div>
                        <div className="text-xs text-slate-700">
                          <span className="line-through decoration-red-500 text-red-700 font-medium">
                            {issue.flagged}
                          </span>{' '}
                          <span className="text-slate-400">→</span>{' '}
                          <span className="font-bold text-emerald-700">
                            {issue.suggestion}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApplySpellIssue(issue)}
                          className="min-h-[34px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                        >
                          Corriger
                        </button>
                        {issue.canAddToDict && (
                          <button
                            type="button"
                            onClick={() => handleIgnoreSpellWord(issue.flagged)}
                            className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 cursor-pointer"
                          >
                            Ignorer
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Quick Previous-Day Duplication Bar */}
          {!readOnly && previousJournal && (
            <div className="rounded-2xl border border-[#0a5b9c]/30 bg-[#0a5b9c]/[0.06] p-3 sm:p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-[#0a5b9c]">
                  Reprise rapide depuis la veille (J. N°{' '}
                  <span className="tabular-nums">
                    {previousJournal.journalNum}
                  </span>{' '}
                  · {fmtDateFR(previousJournal.date)})
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={copyPrevActivities}
                  className="min-h-[42px] px-3 rounded-xl bg-white border border-[#0a5b9c]/35 hover:border-[#0a5b9c] hover:bg-[#0a5b9c] hover:text-white text-xs font-bold text-[#0a5b9c] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span>Dupliquer activités de la veille ({prevActivitiesCount})</span>
                </button>
                <button
                  type="button"
                  onClick={copyPrevWorkers}
                  className="min-h-[42px] px-3 rounded-xl bg-white border border-[#0a5b9c]/35 hover:border-[#0a5b9c] hover:bg-[#0a5b9c] hover:text-white text-xs font-bold text-[#0a5b9c] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>Dupliquer présences de la veille ({prevWorkersCount})</span>
                </button>
                <button
                  type="button"
                  onClick={copyPrevMateriel}
                  className="min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 hover:border-[#0a5b9c] text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <CopyCheck className="w-3.5 h-3.5 text-[#0a5b9c] shrink-0" />
                  <span>Dupliquer matériel (C)</span>
                </button>
              </div>
            </div>
          )}

          {/* Identification & Weather Card */}
          <section
            id="sec-meteo"
            className="rounded-2xl border border-slate-200 bg-white overflow-hidden scroll-mt-20"
          >
            <div
              className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${
                weatherFilled
                  ? 'bg-slate-50 border-slate-200'
                  : 'bg-amber-50/80 border-amber-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="px-2 py-0.5 rounded-lg bg-[#0a5b9c] text-white font-mono text-xs font-extrabold shrink-0">
                  MÉTÉO
                </span>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 truncate">
                  En-tête, horaires &amp; météo
                </h2>
              </div>
              <span
                className={`text-xs font-extrabold shrink-0 ${
                  weatherFilled ? 'text-emerald-700' : 'text-amber-800'
                }`}
              >
                {weatherFilled ? '✓ Complété' : 'À compléter'}
              </span>
            </div>

            <div className="p-3.5 sm:p-4 space-y-3.5">
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                <div className="col-span-1 sm:col-span-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    N° Page
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
                    className="w-full min-h-[42px] px-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                  />
                </div>

                <div className="col-span-1 sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    Date ({dayNameFR(journal.date) || '—'})
                  </label>
                  <input
                    type="date"
                    disabled={readOnly}
                    value={journal.date}
                    onChange={(e) => updateField('date', e.target.value)}
                    className="w-full min-h-[42px] px-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                  />
                </div>

                <div className="col-span-1 sm:col-span-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    Début
                  </label>
                  <input
                    type="time"
                    disabled={readOnly}
                    value={journal.horaireDebut}
                    onChange={(e) => updateField('horaireDebut', e.target.value)}
                    className="w-full min-h-[42px] px-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                  />
                </div>

                <div className="col-span-1 sm:col-span-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    Fin
                  </label>
                  <input
                    type="time"
                    disabled={readOnly}
                    value={journal.horaireFin}
                    onChange={(e) => updateField('horaireFin', e.target.value)}
                    className="w-full min-h-[42px] px-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                  />
                </div>

                <div className="col-span-1 sm:col-span-1 grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-0 hidden sm:block">
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    T° 8h / 16h
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={readOnly}
                      value={journal.tempMatin}
                      onChange={(e) => updateField('tempMatin', e.target.value)}
                      placeholder="8h"
                      className="w-1/2 min-h-[42px] px-1.5 rounded-xl border border-slate-200 text-center text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={readOnly}
                      value={journal.tempApresMidi}
                      onChange={(e) =>
                        updateField('tempApresMidi', e.target.value)
                      }
                      placeholder="16h"
                      className="w-1/2 min-h-[42px] px-1.5 rounded-xl border border-slate-200 text-center text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                  Préposé à la surveillance (ce jour)
                </label>
                <input
                  type="text"
                  lang="fr"
                  disabled={readOnly}
                  value={
                    journal.preposeSurveillance ??
                    chantier.preposeSurveillance ??
                    ''
                  }
                  onChange={(e) =>
                    updateField('preposeSurveillance', e.target.value)
                  }
                  placeholder={
                    chantier.preposeSurveillance ||
                    'Nom du préposé / rédacteur pour cette journée'
                  }
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>

              {/* Mobile compact Temperatures row */}
              <div className="grid grid-cols-2 gap-2.5 sm:hidden">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    T° 8h00 (°C)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={readOnly}
                    value={journal.tempMatin}
                    onChange={(e) => updateField('tempMatin', e.target.value)}
                    placeholder="ex. 6"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    T° 16h15 (°C)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={readOnly}
                    value={journal.tempApresMidi}
                    onChange={(e) =>
                      updateField('tempApresMidi', e.target.value)
                    }
                    placeholder="ex. 14"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50"
                  />
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
                  État atmosphérique
                </div>
                <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-1.5">
                  {ETATS.map((etat) => {
                    const active = journal.etatAtmo.includes(etat);
                    return (
                      <button
                        key={etat}
                        type="button"
                        disabled={readOnly}
                        onClick={() => toggleEtat(etat)}
                        aria-pressed={active}
                        className={`min-h-[38px] px-2.5 sm:px-3 rounded-xl border text-xs font-semibold flex items-center justify-center sm:justify-start gap-1.5 transition-colors ${
                          readOnly
                            ? 'cursor-default opacity-80'
                            : 'cursor-pointer'
                        } ${
                          active
                            ? 'bg-[#0a5b9c] border-[#0a5b9c] text-white'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center border shrink-0 ${
                            active
                              ? 'bg-white text-[#0a5b9c] border-white'
                              : 'border-slate-300'
                          }`}
                        >
                          {active && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </span>
                        <span className="truncate">{etat}</span>
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  lang="fr"
                  spellCheck={true}
                  disabled={readOnly}
                  value={customEtatNote}
                  onChange={(e) => updateCustomEtatNote(e.target.value)}
                  placeholder="Précision météo (ex. Météo sèche, vent modéré…)"
                  className="mt-2 w-full min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15 disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>
            </div>
          </section>

          {/* Section A: Ouvriers */}
          <section
            id="sec-ouvriers"
            className="rounded-2xl border border-slate-200 bg-white overflow-hidden scroll-mt-20"
          >
            <div
              className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${
                totalOuvriers > 0
                  ? 'bg-slate-50 border-slate-200'
                  : 'bg-amber-50/80 border-amber-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-[#0a5b9c] text-white font-mono text-xs font-extrabold flex items-center justify-center shrink-0">
                  A
                </span>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                  Ouvriers &amp; présences
                </h2>
              </div>

              <div className="flex items-center gap-2">
                {!readOnly && previousJournal && (
                  <button
                    type="button"
                    onClick={copyPrevWorkers}
                    className="min-h-[34px] px-2.5 rounded-lg border border-[#0a5b9c]/35 bg-white hover:bg-[#0a5b9c] hover:text-white text-[#0a5b9c] text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                    title="Dupliquer les présences ouvrières de la veille"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Dupliquer présences</span>
                  </button>
                )}
                <span
                  className={`text-xs font-extrabold tabular-nums ${
                    totalOuvriers > 0 ? 'text-emerald-700' : 'text-amber-800'
                  }`}
                >
                  {totalOuvriers > 0
                    ? `✓ ${totalOuvriers} présent${totalOuvriers > 1 ? 's' : ''}`
                    : `À compléter (${validWorkersCount})`}
                </span>
              </div>
            </div>

            <div className="p-3.5 sm:p-4 space-y-2.5">
              {journal.ouvriers.map((o, idx) => (
                <div
                  key={idx}
                  className="p-2.5 sm:p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <AutocompleteInput
                      value={o.firme}
                      disabled={readOnly}
                      onChange={(val) => updateOuvrier(idx, { firme: val })}
                      suggestions={firmSuggestions}
                      placeholder="Firme (ex. Entreprise générale…)"
                    />
                    <input
                      type="text"
                      lang="fr"
                      spellCheck={true}
                      disabled={readOnly}
                      value={o.metier}
                      onChange={(e) =>
                        updateOuvrier(idx, { metier: e.target.value })
                      }
                      placeholder="Métier / Qualification"
                      className="min-h-[42px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-600 mr-1">
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
                          className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
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
                            nbre: Math.max(
                              0,
                              parseInt(e.target.value, 10) || 0
                            ),
                          })
                        }
                        className="w-14 min-h-[40px] px-1.5 rounded-xl border border-slate-200 bg-white text-center text-sm font-extrabold text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c] disabled:bg-slate-50 disabled:text-slate-600"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            updateOuvrier(idx, {
                              nbre: (Number(o.nbre) || 0) + 1,
                            })
                          }
                          className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
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
                        className="min-h-[40px] min-w-[40px] rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                        aria-label="Supprimer cette ligne ouvrier"
                        title="Supprimer cette ligne"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {!readOnly && (
                <button
                  type="button"
                  onClick={addOuvrier}
                  className="w-full min-h-[42px] rounded-xl border border-dashed border-slate-300 hover:border-[#0a5b9c] hover:text-[#0a5b9c] text-slate-600 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter une équipe / ouvrier
                </button>
              )}
            </div>
          </section>

          {/* Sections B, C, E, F, H, J, K */}
          {LINE_SECTIONS.map((sec) => {
            const items = journal[sec.key] || [];
            const nonEmptyCount = items.filter((x) => x.trim()).length;
            const isPrimary = PRIMARY_LINE_KEYS.has(sec.key);
            const isRequiredHighlight = sec.key === 'travaux';
            const isExpanded =
              isPrimary ||
              readOnly ||
              items.length > 0 ||
              Boolean(expandedSecondary[sec.key]);

            if (!isExpanded && !readOnly) {
              return (
                <button
                  key={sec.key}
                  id={`sec-${sec.key}`}
                  type="button"
                  onClick={() => addLine(sec.key)}
                  className="w-full rounded-2xl border border-slate-200 bg-white hover:border-[#0a5b9c]/50 hover:bg-slate-50/80 px-4 py-3 flex items-center justify-between gap-2 text-left cursor-pointer transition-colors scroll-mt-20"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-7 h-7 rounded-lg bg-slate-100 text-[#0a5b9c] font-mono text-xs font-extrabold flex items-center justify-center shrink-0">
                      {sec.code}
                    </span>
                    <span className="text-sm font-bold text-slate-800 truncate">
                      {sec.label}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-[#0a5b9c] flex items-center gap-1 shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                    Ajouter
                  </span>
                </button>
              );
            }

            return (
              <section
                key={sec.key}
                id={`sec-${sec.key}`}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden scroll-mt-20"
              >
                <div
                  className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${
                    isRequiredHighlight && nonEmptyCount === 0
                      ? 'bg-amber-50/80 border-amber-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-7 h-7 rounded-lg bg-[#0a5b9c] text-white font-mono text-xs font-extrabold flex items-center justify-center shrink-0">
                      {sec.code}
                    </span>
                    <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                      {sec.label}
                    </h2>
                  </div>

                  <div className="flex items-center gap-2">
                    {sec.key === 'travaux' && !readOnly && previousJournal && (
                      <button
                        type="button"
                        onClick={copyPrevActivities}
                        className="min-h-[34px] px-2.5 rounded-lg border border-[#0a5b9c]/35 bg-white hover:bg-[#0a5b9c] hover:text-white text-[#0a5b9c] text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        title="Dupliquer les activités de la veille"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Dupliquer activités</span>
                      </button>
                    )}

                    {sec.key === 'materiel' && !readOnly && previousJournal && (
                      <button
                        type="button"
                        onClick={copyPrevMateriel}
                        className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 bg-white hover:border-[#0a5b9c] text-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <CopyCheck className="w-3.5 h-3.5 text-[#0a5b9c]" />
                        <span>Veille</span>
                      </button>
                    )}

                    {isRequiredHighlight ? (
                      <span
                        className={`text-xs font-extrabold tabular-nums ${
                          nonEmptyCount > 0
                            ? 'text-emerald-700'
                            : 'text-amber-800'
                        }`}
                      >
                        {nonEmptyCount > 0
                          ? `✓ ${nonEmptyCount} entrée${nonEmptyCount > 1 ? 's' : ''}`
                          : 'À compléter'}
                      </span>
                    ) : nonEmptyCount > 0 ? (
                      <span className="text-xs font-bold text-emerald-700 tabular-nums">
                        ✓ {nonEmptyCount}
                      </span>
                    ) : !isPrimary && !readOnly ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSecondary((prev) => ({
                            ...prev,
                            [sec.key]: false,
                          }))
                        }
                        className="text-xs font-semibold text-slate-400 hover:text-slate-700 flex items-center gap-0.5 cursor-pointer"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-2.5">
                  {sec.key === 'travaux' && !readOnly && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-500 mr-1">
                        Rapide :
                      </span>
                      {STANDARD_TRAVAUX_PRESETS.map((preset) => {
                        const alreadyUsed = items.some(
                          (x) =>
                            x.trim().toLowerCase() === preset.toLowerCase()
                        );
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => insertPresetTravaux(preset)}
                            className={`min-h-[32px] px-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                              alreadyUsed
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                : 'border-slate-200 bg-slate-50 hover:border-[#0a5b9c] hover:bg-[#0a5b9c]/[0.06] text-slate-700'
                            }`}
                          >
                            {alreadyUsed ? `✓ ${preset}` : `+ ${preset}`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {items.length > 0 && (
                    <div className="space-y-2">
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
                              lang="fr"
                              spellCheck={true}
                              disabled={readOnly}
                              value={line}
                              onChange={(e) =>
                                updateLine(sec.key, idx, e.target.value)
                              }
                              placeholder={sec.placeholder}
                              className="flex-1 min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15 resize-y disabled:bg-slate-50 disabled:text-slate-600"
                            />
                          )}
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => removeLine(sec.key, idx)}
                              className="min-h-[42px] min-w-[42px] rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center shrink-0 cursor-pointer"
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
                      className="w-full min-h-[42px] rounded-xl border border-dashed border-slate-300 hover:border-[#0a5b9c] hover:text-[#0a5b9c] text-slate-600 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Ajouter une ligne ({sec.code})
                    </button>
                  )}
                </div>
              </section>
            );
          })}

          {/* Signatures & Authenticated Verification */}
          <section
            id="sec-signatures"
            className="rounded-2xl border border-slate-200 bg-white overflow-hidden scroll-mt-20"
          >
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="px-2 py-0.5 rounded-lg bg-[#0a5b9c] text-white font-mono text-xs font-extrabold">
                  SIG
                </span>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                  Signatures &amp; authentification (e-ID)
                </h2>
              </div>
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

            <div className="p-3.5 sm:p-4 space-y-3.5">
              {!isCompleted && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                  {isOwner ? (
                    <>
                      La signature authentifiée est activée dès que cette page
                      est marquée comme <strong>Page terminée</strong>.
                    </>
                  ) : (
                    <>
                      Cette page est actuellement <strong>En cours</strong> de
                      rédaction. Vous pouvez la consulter à tout moment, mais la
                      signature est uniquement possible une fois la page marquée{' '}
                      <strong>Page terminée</strong> par le contrôleur.
                    </>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Contrôleur */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-500">
                    Contrôleur responsable (INASEP)
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {journal.signatureControleur?.signerName ||
                      journal.preposeSurveillance ||
                      chantier.preposeSurveillance ||
                      'Non défini'}
                  </div>
                  {journal.signatureControleur ? (
                    <div className="text-[11px] text-emerald-700 space-y-0.5">
                      <div className="font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Certifié via{' '}
                        {formatSignatureMethodLabel(
                          journal.signatureControleur.method,
                          journal.signatureControleur.hardwareVerified
                        )}
                      </div>
                      <div
                        className={`text-[10px] font-semibold ${
                          journal.signatureControleur.hardwareVerified
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {journal.signatureControleur.hardwareVerified
                          ? '✓ Signature puce eID vérifiée (code PIN)'
                          : 'Mode secours compte (sans lecteur PC)'}
                      </div>
                      {journal.signatureControleur.signerEmail && (
                        <div className="text-[10px] text-slate-600 truncate">
                          {journal.signatureControleur.signerEmail}
                        </div>
                      )}
                      <div className="font-mono text-[10px] text-slate-600 truncate">
                        Réf. {journal.signatureControleur.verificationId}
                      </div>
                      {journal.signatureControleur.certIssuer && (
                        <div className="text-[10px] text-slate-600 truncate">
                          AC : {journal.signatureControleur.certIssuer}
                          {journal.signatureControleur.certSerial
                            ? ` · N° ${journal.signatureControleur.certSerial.slice(0, 16)}`
                            : ''}
                        </div>
                      )}
                      {journal.signatureControleur.ocspStatus && (
                        <div className="text-[10px] text-slate-500 truncate">
                          OCSP : {journal.signatureControleur.ocspStatus}
                        </div>
                      )}
                      <div className="font-mono text-[10px] text-slate-500 truncate">
                        SHA-256 :{' '}
                        {journal.signatureControleur.documentSha256.slice(0, 16)}
                        …
                      </div>
                      <div className="text-[10px] text-slate-500 tabular-nums">
                        Le{' '}
                        {new Date(
                          journal.signatureControleur.signedAt
                        ).toLocaleString('fr-BE')}
                      </div>
                      {ctrlVerify && (
                        <div
                          className={`text-[10px] font-semibold ${
                            ctrlVerify.valid
                              ? 'text-emerald-700'
                              : 'text-red-600'
                          }`}
                        >
                          {ctrlVerify.valid
                            ? journal.signatureControleur.hardwareVerified
                              ? '✓ Données + sceau puce eID intacts'
                              : '✓ Données certifiées intactes (SHA-256 + ECDSA)'
                            : `⚠ ${ctrlVerify.reason || 'Empreinte modifiée'}`}
                        </div>
                      )}
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
                        Certifié par {journal.signatureLecteur.signerName} (
                        {formatSignatureMethodLabel(
                          journal.signatureLecteur.method,
                          journal.signatureLecteur.hardwareVerified
                        )}
                        )
                      </div>
                      <div
                        className={`text-[10px] font-semibold ${
                          journal.signatureLecteur.hardwareVerified
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {journal.signatureLecteur.hardwareVerified
                          ? '✓ Signature puce eID vérifiée (code PIN)'
                          : 'Mode secours compte (sans lecteur PC)'}
                      </div>
                      {journal.signatureLecteur.signerEmail && (
                        <div className="text-[10px] text-slate-600 truncate">
                          {journal.signatureLecteur.signerEmail}
                        </div>
                      )}
                      <div className="font-mono text-[10px] text-slate-600 truncate">
                        Réf. {journal.signatureLecteur.verificationId}
                      </div>
                      {journal.signatureLecteur.certIssuer && (
                        <div className="text-[10px] text-slate-600 truncate">
                          AC : {journal.signatureLecteur.certIssuer}
                          {journal.signatureLecteur.certSerial
                            ? ` · N° ${journal.signatureLecteur.certSerial.slice(0, 16)}`
                            : ''}
                        </div>
                      )}
                      {journal.signatureLecteur.ocspStatus && (
                        <div className="text-[10px] text-slate-500 truncate">
                          OCSP : {journal.signatureLecteur.ocspStatus}
                        </div>
                      )}
                      <div className="font-mono text-[10px] text-slate-500 truncate">
                        SHA-256 :{' '}
                        {journal.signatureLecteur.documentSha256.slice(0, 16)}…
                      </div>
                      <div className="text-[10px] text-slate-500 tabular-nums">
                        Le{' '}
                        {new Date(
                          journal.signatureLecteur.signedAt
                        ).toLocaleString('fr-BE')}
                      </div>
                      {lectVerify && (
                        <div
                          className={`text-[10px] font-semibold ${
                            lectVerify.valid
                              ? 'text-emerald-700'
                              : 'text-red-600'
                          }`}
                        >
                          {lectVerify.valid
                            ? journal.signatureLecteur.hardwareVerified
                              ? '✓ Données + sceau puce eID intacts'
                              : '✓ Données certifiées intactes (SHA-256 + ECDSA)'
                            : `⚠ ${lectVerify.reason || 'Empreinte modifiée'}`}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">
                      En attente de signature du lecteur temporaire
                    </div>
                  )}
                </div>
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

      {/* Compact Mobile Sticky Bottom Action Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 flex items-center gap-2">
        {(canMarkCompleted || canReopenToInProgress) && (
          <button
            type="button"
            onClick={() =>
              onToggleStatus(isCompleted ? 'in_progress' : 'completed')
            }
            className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
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
            className="flex-1 min-h-[42px] px-3 rounded-xl bg-[#0a5b9c] text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            Signer (e-ID)
          </button>
        )}

        {canAuthorRole && (
          <>
            <button
              type="button"
              onClick={onPrintSingle}
              className="min-h-[42px] px-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              aria-label="Imprimer"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onExportDayPdf}
              className="flex-1 min-h-[42px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
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
