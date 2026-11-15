import { useEffect, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  FolderOpen,
  Trash2,
  X,
  Check,
  AlertCircle,
  Lock,
} from 'lucide-react';
import type { Chantier } from '../types';
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
  onSave: (chantier: Chantier) => void;
  onNotify: (msg: string, tone?: 'default' | 'success' | 'error') => void;
}

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
    setPostes(editingChantier?.postes ? [...editingChantier.postes] : []);
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
        setPostes(parsed.postes);
      }
      setErrorMsg(null);
      onNotify(
        `Fichier importé (${parsed.postes.length} poste(s) de bordereau).`,
        'success'
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!numero.trim() && !projet.trim()) {
      setErrorMsg('Indiquez au moins un numéro de chantier ou un nom de projet.');
      return;
    }

    onSave({
      id: draftId,
      ownerId: editingChantier?.ownerId,
      ownerName: editingChantier?.ownerName,
      visibility: 'private',
      readerIds: editingChantier?.readerIds || [],
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
    });
  };

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
                  Importer un fichier Excel (.xlsx)
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Lit l&apos;onglet <span className="font-semibold">Aperçu</span> et
                  charge les postes du bordereau pour l&apos;autocomplétion.
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
                  <strong className="tabular-nums">{postes.length}</strong> poste(s)
                  de bordereau prêts pour l&apos;autocomplétion (Section B)
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPostes([])}
                className="text-emerald-800 hover:text-red-700 font-semibold underline cursor-pointer ml-3"
              >
                Effacer
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
              vous seul pouvez rédiger et consulter ces journaux. Pour partager
              temporairement ce dossier en lecture, utilisez{' '}
              <strong>« Accès temporaire »</strong> sur la fiche du chantier.
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
              className="min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm cursor-pointer"
            >
              {editingChantier ? 'Enregistrer' : 'Créer le chantier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
