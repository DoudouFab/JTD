import { useEffect, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  FolderOpen,
  Trash2,
  X,
  Check,
  AlertCircle,
  Lock,
  Mail,
  Send,
  Copy,
  Plus,
} from 'lucide-react';
import { STANDARD_TRAVAUX_PRESETS, type Chantier } from '../types';
import { clampEmailList } from '../utils/firestoreService';
import {
  DEFAULT_DAY_FOLDER_KEY,
  DEFAULT_WEEK_FOLDER_KEY,
  deleteDirHandle,
  getDirHandle,
  isFsAccessSupported,
  pickAndStoreFolder,
  uid,
} from '../utils/storage';
import { parseChantierXlsx } from '../utils/xlsxImport';

interface ChantierModalProps {
  open: boolean;
  editingChantier: Chantier | null;
  defaultPrepose?: string;
  defaultHoraireDebut?: string;
  defaultHoraireFin?: string;
  onClose: () => void;
  onSave: (
    chantier: Chantier,
    options?: { keepOpen?: boolean }
  ) => Promise<boolean | void> | void;
  onNotify: (msg: string, tone?: 'default' | 'success' | 'error') => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ChantierModal({
  open,
  editingChantier,
  defaultPrepose = '',
  defaultHoraireDebut = '07:30',
  defaultHoraireFin = '16:30',
  onClose,
  onSave,
  onNotify,
}: ChantierModalProps) {
  const [draftId, setDraftId] = useState<string>('');
  const [numero, setNumero] = useState('');
  const [projet, setProjet] = useState('');
  const [entrepriseNom, setEntrepriseNom] = useState('');
  const [entrepriseAdresse, setEntrepriseAdresse] = useState('');
  const [references, setReferences] = useState('');
  const [adresseChantier, setAdresseChantier] = useState('');
  const [horaireDebut, setHoraireDebut] = useState('07:30');
  const [horaireFin, setHoraireFin] = useState('16:30');
  const [preposeSurveillance, setPreposeSurveillance] = useState('');
  const [postes, setPostes] = useState<string[]>([]);
  const [readerEmails, setReaderEmails] = useState<string[]>([]);
  const [savingBusy, setSavingBusy] = useState(false);

  const [dayFolderName, setDayFolderName] = useState<string | null>(null);
  const [weekFolderName, setWeekFolderName] = useState<string | null>(null);
  const [defaultDayFolderName, setDefaultDayFolderName] = useState<string | null>(
    null
  );
  const [defaultWeekFolderName, setDefaultWeekFolderName] = useState<
    string | null
  >(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const xlsxInputRef = useRef<HTMLInputElement | null>(null);
  const fsSupported = isFsAccessSupported();

  useEffect(() => {
    if (!open) return;

    const id = editingChantier ? editingChantier.id : uid();
    setDraftId(id);
    setNumero(editingChantier?.numero || '');
    setProjet(editingChantier?.projet || '');
    setEntrepriseNom(editingChantier?.entrepriseNom || '');
    setEntrepriseAdresse(editingChantier?.entrepriseAdresse || '');
    setReferences(editingChantier?.references || '');
    setAdresseChantier(editingChantier?.adresseChantier || '');
    setHoraireDebut(editingChantier?.horaireDebut || defaultHoraireDebut);
    setHoraireFin(editingChantier?.horaireFin || defaultHoraireFin);
    setPreposeSurveillance(
      editingChantier ? editingChantier.preposeSurveillance : defaultPrepose
    );
    setPostes(
      editingChantier?.postes
        ? Array.from(
            new Set([
              ...STANDARD_TRAVAUX_PRESETS,
              ...editingChantier.postes.filter((p) => p?.trim()),
            ])
          )
        : [...STANDARD_TRAVAUX_PRESETS]
    );
    setReaderEmails(
      editingChantier?.readerEmails?.length
        ? editingChantier.readerEmails.slice(0, 3)
        : []
    );
    setSavingBusy(false);
    setErrorMsg(null);

    if (fsSupported) {
      getDirHandle(`dayFolder_${id}`).then((h) =>
        setDayFolderName(h ? h.name : null)
      );
      getDirHandle(`weekFolder_${id}`).then((h) =>
        setWeekFolderName(h ? h.name : null)
      );
      getDirHandle(DEFAULT_DAY_FOLDER_KEY).then((h) =>
        setDefaultDayFolderName(h ? h.name : null)
      );
      getDirHandle(DEFAULT_WEEK_FOLDER_KEY).then((h) =>
        setDefaultWeekFolderName(h ? h.name : null)
      );
    } else {
      setDayFolderName(null);
      setWeekFolderName(null);
      setDefaultDayFolderName(null);
      setDefaultWeekFolderName(null);
    }
  }, [
    open,
    editingChantier,
    fsSupported,
    defaultPrepose,
    defaultHoraireDebut,
    defaultHoraireFin,
  ]);

  if (!open) return null;

  const handleXlsxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const parsed = await parseChantierXlsx(file);
      if (parsed.numero) setNumero(parsed.numero);
      if (parsed.projet) setProjet(parsed.projet);
      if (parsed.entrepriseNom) setEntrepriseNom(parsed.entrepriseNom);
      if (parsed.entrepriseAdresse) setEntrepriseAdresse(parsed.entrepriseAdresse);
      if (parsed.references) setReferences(parsed.references);
      if (parsed.adresseChantier) setAdresseChantier(parsed.adresseChantier);
      if (parsed.preposeSurveillance) {
        setPreposeSurveillance(parsed.preposeSurveillance);
      }
      if (parsed.postes.length) {
        setPostes(
          Array.from(new Set([...STANDARD_TRAVAUX_PRESETS, ...parsed.postes]))
        );
      } else if (!postes.length) {
        setPostes([...STANDARD_TRAVAUX_PRESETS]);
      }
      setErrorMsg(null);
      onNotify(
        parsed.filledCount > 0
          ? `${parsed.filledCount} info(s) chantier reprise(s) · ${parsed.postes.length} poste(s) de bordereau.`
          : `Aucune info chantier détectée · ${parsed.postes.length} poste(s) de bordereau.`,
        parsed.filledCount > 0 ? 'success' : 'default'
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Erreur de lecture du fichier .xlsx.';
      setErrorMsg(msg);
      onNotify(msg, 'error');
    }
  };

  const handlePickFolder = async (type: 'day' | 'week') => {
    if (!draftId) return;
    try {
      const key = `${type === 'day' ? 'dayFolder_' : 'weekFolder_'}${draftId}`;
      const handle = await pickAndStoreFolder(key);
      if (handle) {
        if (type === 'day') setDayFolderName(handle.name);
        else setWeekFolderName(handle.name);
        onNotify(`Dossier « ${handle.name} » sélectionné.`, 'success');
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        onNotify('Impossible de sélectionner le dossier.', 'error');
      }
    }
  };

  const handleUnlinkFolder = async (type: 'day' | 'week') => {
    if (!draftId) return;
    const key = `${type === 'day' ? 'dayFolder_' : 'weekFolder_'}${draftId}`;
    await deleteDirHandle(key);
    if (type === 'day') setDayFolderName(null);
    else setWeekFolderName(null);
    onNotify('Dossier dissocié.');
  };

  const validateAndBuildChantier = (): Chantier | null => {
    if (!numero.trim() && !projet.trim()) {
      setErrorMsg('Indiquez au moins un numéro de chantier ou un nom de projet.');
      return null;
    }

    for (const raw of readerEmails) {
      const trimmed = raw.trim().toLowerCase();
      if (trimmed && !EMAIL_RE.test(trimmed)) {
        setErrorMsg(
          `Adresse e-mail de lecteur invalide : « ${raw.trim()} ». Corrigez-la ou supprimez la ligne.`
        );
        return null;
      }
    }

    setErrorMsg(null);
    return {
      id: draftId,
      ownerId: editingChantier?.ownerId,
      ownerName: editingChantier?.ownerName,
      visibility: 'private',
      readerIds: editingChantier?.readerIds || [],
      readerEmails: clampEmailList(readerEmails, 3),
      numero: numero.trim(),
      projet: projet.trim(),
      entrepriseNom: entrepriseNom.trim(),
      entrepriseAdresse: entrepriseAdresse.trim(),
      references: references.trim(),
      adresseChantier: adresseChantier.trim(),
      horaireDebut: horaireDebut || '07:30',
      horaireFin: horaireFin || '16:30',
      preposeSurveillance: preposeSurveillance.trim(),
      postes,
    };
  };

  const buildShareLink = (): string => {
    try {
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('chantier', draftId);
      return url.toString();
    } catch {
      return `${window.location.origin}/?chantier=${encodeURIComponent(draftId)}`;
    }
  };

  const buildEmailContent = () => {
    const refText = references.trim() || numero.trim() || draftId;
    const titre =
      [numero.trim(), projet.trim()].filter(Boolean).join(' — ') ||
      'Journal des travaux';
    const shareLink = buildShareLink();
    const subject = `Accès Journal des travaux — ${titre} (Réf. ${refText})`;
    const body = [
      'Bonjour,',
      '',
      `Voici vos accès à la consultation de votre journal des travaux (référence : ${refText}${projet.trim() ? ` — ${projet.trim()}` : ''}) :`,
      shareLink,
      '',
      'Connectez-vous avec cette adresse e-mail dans l’application (compte Google ou « E-mail pro » avec confirmation). Aucun code collègue supplémentaire n’est nécessaire : votre accès s’ouvrira automatiquement en lecture seule et signature pour ce dossier.',
      '',
      'Merci de bien vouloir consulter régulièrement et approuver les pages rédigées et terminées.',
      '',
      preposeSurveillance.trim()
        ? `Bien à vous,\n${preposeSurveillance.trim()}`
        : 'Bien à vous,',
    ].join('\n');
    return { subject, body, shareLink };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = validateAndBuildChantier();
    if (!payload) return;
    setSavingBusy(true);
    try {
      await onSave(payload);
    } finally {
      setSavingBusy(false);
    }
  };

  const handleSaveAndSendMail = async () => {
    const payload = validateAndBuildChantier();
    if (!payload) return;
    const emails = payload.readerEmails || [];
    if (!emails.length) {
      setErrorMsg(
        'Encodez au moins une adresse e-mail ci-dessous pour envoyer les accès.'
      );
      return;
    }

    setSavingBusy(true);
    try {
      const savedOk = await onSave(payload, { keepOpen: true });
      if (savedOk === false) return;

      const { subject, body } = buildEmailContent();
      const mailtoHref = `mailto:${encodeURIComponent(emails.join(','))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailtoHref;
      onNotify(
        `Chantier enregistré et e-mail préparé pour ${emails.join(', ')}.`,
        'success'
      );
    } finally {
      setSavingBusy(false);
    }
  };

  const handleCopyEmailText = async () => {
    const payload = validateAndBuildChantier();
    if (!payload) return;
    const { subject, body } = buildEmailContent();
    try {
      await navigator.clipboard.writeText(`Objet : ${subject}\n\n${body}`);
      onNotify('Message d’accès et lien copiés dans le presse-papiers.', 'success');
    } catch {
      onNotify('Copie automatique impossible sur ce navigateur.', 'error');
    }
  };

  const validEmailsCount = clampEmailList(readerEmails, 3).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92dvh] bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {editingChantier ? 'Modifier le chantier' : 'Nouveau chantier'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Renseignez les coordonnées ou importez directement un classeur Excel.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-5">
          {/* Excel Import Banner */}
          <div className="rounded-xl border border-dashed border-[#0a5b9c]/40 bg-[#0a5b9c]/[0.03] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">
                  Importer un fichier Excel 3P (.xlsx)
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Lit automatiquement l&apos;onglet{' '}
                  <span className="font-semibold">Aperçu</span> (chantier,
                  références, projet, adjudicataire, adresses, surveillant) et
                  les postes du bordereau.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                ref={xlsxInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleXlsxChange}
              />
              <button
                type="button"
                onClick={() => xlsxInputRef.current?.click()}
                className="min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold cursor-pointer whitespace-nowrap"
              >
                Choisir .xlsx
              </button>
            </div>
          </div>

          {postes.length > 0 && (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              <span className="font-medium flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  <strong className="tabular-nums">{postes.length}</strong> ligne(s)
                  pré-encodées (mentions standard + postes 3P) prêtes pour la Section B
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPostes([...STANDARD_TRAVAUX_PRESETS])}
                className="text-emerald-800 hover:text-red-700 font-semibold underline cursor-pointer ml-3"
              >
                Réinitialiser 3P
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Strict Private Isolation Notice */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-[#0a5b9c] shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-900">Chantier personnel (privé)</strong> :
              vous seul pouvez rédiger ces journaux. Pour accorder un{' '}
              <strong>accès automatique en lecture seule &amp; signature</strong>{' '}
              à l&apos;entrepreneur ou au maître d&apos;ouvrage sur{' '}
              <strong>ce dossier uniquement</strong>, encodez 0 à 3 adresses
              e-mail ci-dessous.
            </div>
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                N° de chantier
              </label>
              <input
                type="text"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="ex. 2026-042"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Références
              </label>
              <input
                type="text"
                value={references}
                onChange={(e) => setReferences(e.target.value)}
                placeholder="ex. 25279-11-3"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Nom du projet
            </label>
            <input
              type="text"
              lang="fr"
              spellCheck={true}
              value={projet}
              onChange={(e) => setProjet(e.target.value)}
              placeholder="ex. Égouttage Rue de la Station"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Entreprise adjudicataire
              </label>
              <input
                type="text"
                lang="fr"
                spellCheck={true}
                value={entrepriseNom}
                onChange={(e) => setEntrepriseNom(e.target.value)}
                placeholder="Nom de la firme"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Préposé à la surveillance
              </label>
              <input
                type="text"
                value={preposeSurveillance}
                onChange={(e) => setPreposeSurveillance(e.target.value)}
                placeholder="Nom du surveillant INASEP"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Adresse de l&apos;entreprise
              </label>
              <textarea
                rows={2}
                lang="fr"
                spellCheck={true}
                value={entrepriseAdresse}
                onChange={(e) => setEntrepriseAdresse(e.target.value)}
                placeholder="Rue, CP, Localité"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15 resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Adresse du chantier
              </label>
              <textarea
                rows={2}
                lang="fr"
                spellCheck={true}
                value={adresseChantier}
                onChange={(e) => setAdresseChantier(e.target.value)}
                placeholder="Rue, Commune"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15 resize-y"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Horaire début
              </label>
              <input
                type="time"
                value={horaireDebut}
                onChange={(e) => setHoraireDebut(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                Horaire fin
              </label>
              <input
                type="time"
                value={horaireFin}
                onChange={(e) => setHoraireFin(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c]"
              />
            </div>
          </div>

          {/* OneDrive Folders */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-700">
                Dossiers OneDrive / PC (export PDF automatique)
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {fsSupported
                  ? 'Sélectionnez les sous-dossiers OneDrive synchronisés sur cet appareil pour y déposer directement les PDF.'
                  : 'Sur ce navigateur (ex. Safari iOS), les PDF seront téléchargés automatiquement dans Fichiers / Téléchargements.'}
              </p>
            </div>

            {fsSupported && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl bg-white border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-500">
                    Dossier PDF Journées
                  </div>
                  <div className="text-sm font-semibold text-slate-900 truncate mt-0.5 mb-2.5">
                    {dayFolderName
                      ? dayFolderName
                      : defaultDayFolderName
                        ? `Défaut du compte : ${defaultDayFolderName}`
                        : 'Non lié (téléchargement)'}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePickFolder('day')}
                      className="flex-1 min-h-[40px] px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Choisir
                    </button>
                    {dayFolderName && (
                      <button
                        type="button"
                        onClick={() => handleUnlinkFolder('day')}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 cursor-pointer"
                        title="Dissocier"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-500">
                    Dossier PDF Semaines
                  </div>
                  <div className="text-sm font-semibold text-slate-900 truncate mt-0.5 mb-2.5">
                    {weekFolderName
                      ? weekFolderName
                      : defaultWeekFolderName
                        ? `Défaut du compte : ${defaultWeekFolderName}`
                        : 'Non lié (téléchargement)'}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePickFolder('week')}
                      className="flex-1 min-h-[40px] px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Choisir
                    </button>
                    {weekFolderName && (
                      <button
                        type="button"
                        onClick={() => handleUnlinkFolder('week')}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 cursor-pointer"
                        title="Dissocier"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Single-dossier Email Reader & Signer Sharing (0 to 3 emails) */}
          <div className="rounded-xl border border-[#0a5b9c]/25 bg-[#0a5b9c]/[0.03] p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center shrink-0 mt-0.5">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-800">
                    Partage lecture seule &amp; signature (0 à 3 e-mails)
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Une fois encodées et enregistrées, ces adresses accèdent
                    automatiquement à <strong>ce chantier uniquement</strong>{' '}
                    (consultation à tout moment des pages En cours &amp;
                    Terminées, signature itsme® / eID des pages terminées).
                  </p>
                </div>
              </div>
              {readerEmails.length < 3 && (
                <button
                  type="button"
                  onClick={() => setReaderEmails((prev) => [...prev, ''])}
                  className="min-h-[38px] px-3 rounded-xl border border-[#0a5b9c]/40 bg-white hover:bg-[#0a5b9c]/5 text-[#0a5b9c] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 self-start sm:self-center"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter ({readerEmails.length}/3)
                </button>
              )}
            </div>

            {readerEmails.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3.5 py-3 text-xs text-slate-500">
                Aucune adresse e-mail encodée (0/3). Cliquez sur{' '}
                <strong>« Ajouter »</strong> pour inviter l&apos;entrepreneur ou
                un destinataire à consulter et signer ce dossier.
              </div>
            ) : (
              <div className="space-y-2">
                {readerEmails.map((em, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="email"
                      value={em}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReaderEmails((prev) =>
                          prev.map((item, i) => (i === idx ? val : item))
                        );
                      }}
                      placeholder={`Destinataire ${idx + 1} (ex. conducteur@entreprise.be)`}
                      className="flex-1 min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setReaderEmails((prev) =>
                          prev.filter((_, i) => i !== idx)
                        )
                      }
                      className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-200 cursor-pointer shrink-0"
                      title="Retirer cette adresse"
                      aria-label="Retirer cette adresse"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {validEmailsCount > 0 && (
              <div className="pt-1 space-y-2.5">
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600 leading-relaxed whitespace-pre-line">
                  <div className="font-bold text-slate-800 mb-1">
                    Aperçu du message d&apos;invitation :
                  </div>
                  {`Voici vos accès à la consultation de votre journal des travaux (référence : ${references.trim() || numero.trim() || draftId}${projet.trim() ? ` — ${projet.trim()}` : ''}) :\n${buildShareLink()}\n\nMerci de bien vouloir consulter régulièrement et approuver les pages rédigées et terminées.`}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={savingBusy}
                    onClick={() => void handleSaveAndSendMail()}
                    className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    <Send className="w-4 h-4" />
                    {savingBusy
                      ? 'Enregistrement…'
                      : `Enregistrer et envoyer par e-mail (${validEmailsCount})`}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCopyEmailText()}
                    className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copier message &amp; lien
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={savingBusy}
              className="min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm cursor-pointer disabled:opacity-60"
            >
              {savingBusy
                ? 'Enregistrement…'
                : editingChantier
                  ? 'Enregistrer'
                  : 'Créer le chantier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
