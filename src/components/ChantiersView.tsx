import { useRef, useState } from 'react';
import {
  Building2,
  ChevronRight,
  Clock,
  CloudUpload,
  Download,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Chantier, ChantierShare } from '../types';

interface ChantiersViewProps {
  chantiers: Chantier[];
  shareByChantierId: Record<string, ChantierShare>;
  currentUserId: string;
  lastBackupIso: string | null;
  localMigrationCount: number;
  migratingLocal: boolean;
  onMigrateLocal: () => void;
  onSelectChantier: (id: string) => void;
  onNewChantier: () => void;
  onEditChantier: (ch: Chantier) => void;
  onDeleteChantier: (ch: Chantier) => void;
  onRedeemInvite: (code: string) => Promise<void>;
  onExportJson: () => void;
  onImportJsonFile: (file: File) => void;
}

export function ChantiersView({
  chantiers,
  shareByChantierId,
  currentUserId,
  lastBackupIso,
  localMigrationCount,
  migratingLocal,
  onMigrateLocal,
  onSelectChantier,
  onNewChantier,
  onEditChantier,
  onDeleteChantier,
  onRedeemInvite,
  onExportJson,
  onImportJsonFile,
}: ChantiersViewProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'shared'>('all');
  const [inviteCode, setInviteCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const ownedCount = chantiers.filter((c) => c.ownerId === currentUserId).length;
  const sharedCount = chantiers.filter((c) => c.ownerId !== currentUserId).length;

  const filtered = chantiers.filter((ch) => {
    const isMine = ch.ownerId === currentUserId;
    if (scope === 'mine' && !isMine) return false;
    if (scope === 'shared' && isMine) return false;
    if (!normalizedQuery) return true;
    const hay = [
      ch.numero,
      ch.projet,
      ch.references,
      ch.entrepriseNom,
      ch.preposeSurveillance,
      ch.adresseChantier,
      ch.ownerName,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(normalizedQuery);
  });

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

  return (
    <div className="space-y-6">
      {/* Local-to-Cloud One-Click Migration Banner */}
      {localMigrationCount > 0 && (
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

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Chantiers
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5 tabular-nums">
            {ownedCount} dossier(s) personnel(s)
            {sharedCount > 0
              ? ` · ${sharedCount} accès temporaire(s) en lecture`
              : ' · Espace privé et cloisonné'}
          </p>
        </div>

        <button
          type="button"
          onClick={onNewChantier}
          className="min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nouveau chantier
        </button>
      </div>

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

      {/* Search + Quick Scope Filter */}
      {chantiers.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par numéro, projet, référence, entrepreneur…"
              className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
            />
          </div>

          {sharedCount > 0 && (
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
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap ${
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

      {/* Chantiers Grid or Empty State */}
      {chantiers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 sm:p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            Aucun chantier enregistré
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-1.5">
            Créez votre premier chantier personnel ou saisissez un code
            d&apos;accès temporaire pour consulter un dossier partagé avec vous.
          </p>
          <button
            type="button"
            onClick={onNewChantier}
            className="mt-5 min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Créer un chantier
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-600">
            Aucun chantier ne correspond à ce filtre.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setScope('all');
            }}
            className="mt-3 text-sm font-semibold text-[#0a5b9c] hover:underline cursor-pointer"
          >
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((ch) => {
            const isOwner = ch.ownerId === currentUserId;
            const shareInfo = shareByChantierId[ch.id];

            return (
              <div
                key={ch.id}
                onClick={() => onSelectChantier(ch.id)}
                className="group rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 hover:border-[#0a5b9c]/50 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-mono font-semibold text-[#0a5b9c] uppercase tracking-wide">
                        {ch.numero ? `Chantier ${ch.numero}` : 'Sans numéro'}
                        {ch.references ? ` · Réf. ${ch.references}` : ''}
                      </div>
                      <h2 className="text-base font-bold text-slate-900 mt-1 line-clamp-2 group-hover:text-[#0a5b9c] transition-colors">
                        {ch.projet || 'Projet sans titre'}
                      </h2>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-[#0a5b9c] shrink-0 mt-0.5 transition-colors" />
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-slate-600">
                    <div className="truncate">
                      <span className="text-slate-400">Entreprise :</span>{' '}
                      <span className="font-medium text-slate-700">
                        {ch.entrepriseNom || '—'}
                      </span>
                    </div>
                    <div className="truncate">
                      <span className="text-slate-400">Surveillance :</span>{' '}
                      <span className="font-medium text-slate-700">
                        {ch.preposeSurveillance || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-500 tabular-nums truncate flex items-center gap-1.5">
                    {isOwner ? (
                      <>
                        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>
                          Personnel
                          {ch.postes.length > 0
                            ? ` · ${ch.postes.length} postes`
                            : ''}
                          {(ch.readerIds?.length || 0) > 0
                            ? ` · ${ch.readerIds!.length} lecteur(s)`
                            : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span className="text-amber-800 font-medium truncate">
                          Lecture temporaire
                          {shareInfo
                            ? ` · jusqu'au ${new Date(
                                shareInfo.expiresAtMs
                              ).toLocaleDateString('fr-BE')}`
                            : ''}
                        </span>
                      </>
                    )}
                  </div>

                  {isOwner && (
                    <div
                      className="flex items-center -mr-2 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onEditChantier(ch)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-[#0a5b9c] hover:bg-slate-100 cursor-pointer"
                        title="Modifier le chantier"
                        aria-label="Modifier le chantier"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteChantier(ch)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        title="Supprimer le chantier"
                        aria-label="Supprimer le chantier"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Backup & Export JSON Section */}
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
