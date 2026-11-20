import { useCallback, useEffect, useState } from 'react';
import { type User } from 'firebase/auth';
import {
  Clock,
  Copy,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldOff,
  UserCheck,
  X,
} from 'lucide-react';
import type { Chantier, ChantierShare, ShareInvite } from '../types';
import {
  createShareInvite,
  deactivateShareInvite,
  fetchOwnerShareDataOnce,
  revokeChantierShare,
} from '../utils/firestoreService';

interface ShareAccessModalProps {
  open: boolean;
  chantier: Chantier;
  user: User;
  onClose: () => void;
  onNotify: (msg: string, tone?: 'default' | 'success' | 'error') => void;
}

const MONTH_OPTIONS = [
  { months: 1, label: '1 mois' },
  { months: 3, label: '3 mois' },
  { months: 6, label: '6 mois' },
  { months: 12, label: '12 mois (1 an)' },
  { months: 24, label: '24 mois (2 ans)' },
  { months: 36, label: '36 mois (3 ans)' },
];

export function ShareAccessModal({
  open,
  chantier,
  user,
  onClose,
  onNotify,
}: ShareAccessModalProps) {
  const [label, setLabel] = useState('');
  const [durationMonths, setDurationMonths] = useState<number>(36);
  const [useCustomMonths, setUseCustomMonths] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [invites, setInvites] = useState<ShareInvite[]>([]);
  const [shares, setShares] = useState<ChantierShare[]>([]);

  const loadShareData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOwnerShareDataOnce(chantier.id, user.uid);
      setInvites(data.invites);
      setShares(data.shares);
    } finally {
      setLoading(false);
    }
  }, [chantier.id, user.uid]);

  useEffect(() => {
    if (!open) return;
    setDurationMonths(36);
    setUseCustomMonths(false);
    void loadShareData();
  }, [open, loadShareData]);

  if (!open) return null;

  const now = Date.now();
  const activeInvites = invites.filter(
    (inv) => inv.active && inv.expiresAtMs > now
  );
  const activeShares = shares.filter(
    (s) => !s.revoked && s.expiresAtMs > now
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const safeMonths = Math.max(1, Math.min(120, Math.round(durationMonths || 36)));
    setCreating(true);
    try {
      const inv = await createShareInvite(
        chantier,
        user,
        label || 'Lecteur autorisé',
        safeMonths
      );
      setLabel('');
      setInvites((prev) => [inv, ...prev]);
      onNotify(
        `Code temporaire généré (${safeMonths} mois) : ${inv.code}`,
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : "Impossible de créer l'accès temporaire.",
        'error'
      );
    } finally {
      setCreating(false);
    }
  };

  const copyText = async (text: string, feedback: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(feedback, 'success');
    } catch {
      onNotify('Copie impossible automatiquement — sélectionnez le texte.', 'error');
    }
  };

  const buildInviteUrl = (code: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('invite', code);
    return url.toString();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div className="w-full max-w-xl max-h-[92vh] bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="share-modal-title"
              className="text-base font-bold text-slate-900 flex items-center gap-2"
            >
              <Clock className="w-5 h-5 text-[#0a5b9c]" />
              Accès temporaire en lecture
            </h2>
            <p className="text-xs text-slate-500 truncate mt-0.5">
              Uniquement pour le dossier :{' '}
              <strong>
                {chantier.numero ? `${chantier.numero} — ` : ''}
                {chantier.projet || 'Chantier'}
              </strong>
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void loadShareData()}
              disabled={loading}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-[#0a5b9c] hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              title="Actualiser"
              aria-label="Actualiser"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              aria-label="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Create Temporary Invite */}
          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
          >
            <div className="text-xs font-bold uppercase tracking-wide text-slate-700">
              Accorder un nouvel accès temporaire
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Le destinataire (compte approuvé) pourra consulter les pages
              terminées, la page en cours et les semaines terminées de ce
              dossier uniquement, signer via itsme®/eID et télécharger le PDF
              une fois la semaine entièrement signée.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Destinataire / libellé
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="ex. Entrepreneur Dupont"
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Validité en mois (pré-encodée : 3 ans)
                </label>
                {!useCustomMonths ? (
                  <select
                    value={durationMonths}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setUseCustomMonths(true);
                      } else {
                        setDurationMonths(Number(e.target.value));
                      }
                    }}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
                  >
                    {MONTH_OPTIONS.map((opt) => (
                      <option key={opt.months} value={opt.months}>
                        {opt.label}
                      </option>
                    ))}
                    <option value="custom">Autre durée (en mois)…</option>
                  </select>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={durationMonths}
                      onChange={(e) =>
                        setDurationMonths(Math.max(1, Number(e.target.value) || 1))
                      }
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c]"
                    />
                    <span className="text-xs font-semibold text-slate-500 shrink-0">
                      mois
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setUseCustomMonths(false);
                        setDurationMonths(36);
                      }}
                      className="text-xs font-semibold text-[#0a5b9c] hover:underline shrink-0 cursor-pointer"
                    >
                      3 ans
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4" />
                {creating
                  ? 'Création…'
                  : 'Générer un code temporaire'}
              </button>
            </div>
          </form>

          {/* Active Readers */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              Accès actifs sur ce dossier ({activeShares.length})
            </h3>
            {activeShares.length === 0 ? (
              <div className="p-3.5 rounded-xl border border-slate-200 text-xs text-slate-500">
                Aucun lecteur temporaire actif pour ce chantier.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                {activeShares.map((s) => (
                  <div
                    key={s.id}
                    className="px-3.5 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">
                        {s.readerName || s.label}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {s.label ? `${s.label} · ` : ''}Expire le{' '}
                        {new Date(s.expiresAtMs).toLocaleDateString('fr-BE')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await revokeChantierShare(s);
                          setShares((prev) =>
                            prev.filter((item) => item.id !== s.id)
                          );
                          onNotify('Accès temporaire révoqué.', 'default');
                        } catch {
                          onNotify('Impossible de révoquer.', 'error');
                        }
                      }}
                      className="min-h-[38px] px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <ShieldOff className="w-3.5 h-3.5" />
                      Révoquer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending / Active Invite Codes */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Codes d&apos;invitation valides ({activeInvites.length})
            </h3>
            {activeInvites.length === 0 ? (
              <div className="p-3.5 rounded-xl border border-slate-200 text-xs text-slate-500">
                Aucun code en cours.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                {activeInvites.map((inv) => (
                  <div
                    key={inv.code}
                    className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-extrabold text-[#0a5b9c]">
                          {inv.code}
                        </span>
                        <span className="text-xs text-slate-500 truncate">
                          ({inv.label})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                        Valable jusqu&apos;au{' '}
                        {new Date(inv.expiresAtMs).toLocaleDateString('fr-BE')}
                        {inv.usedByUid ? ' · Utilisé' : ' · Non encore utilisé'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(
                            inv.code,
                            `Code ${inv.code} copié.`
                          )
                        }
                        className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Code
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(
                            buildInviteUrl(inv.code),
                            'Lien temporaire copié.'
                          )
                        }
                        className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        Lien
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await deactivateShareInvite(inv.code);
                            setInvites((prev) =>
                              prev.filter((item) => item.code !== inv.code)
                            );
                            onNotify('Code désactivé.');
                          } catch {
                            onNotify('Erreur lors de la désactivation.', 'error');
                          }
                        }}
                        className="min-h-[36px] px-2.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold cursor-pointer"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
