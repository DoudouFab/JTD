import { useEffect, useState } from 'react';
import { signOut, type User } from 'firebase/auth';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';
import { auth, FIRESTORE_QUOTA_URL } from '../firebase';
import { APP_SIGNATURE, type AccessUserRecord } from '../types';
import {
  activateWithPersonalCode,
  redeemDossierPinCode,
  requestAccessWithoutCode,
} from '../utils/firestoreService';
import { AppLogo } from './AppLogo';

export type AccessGateState =
  | 'needs_code'
  | 'pending'
  | 'revoked'
  | 'offline_unapproved'
  | 'quota_exceeded';

interface AccessGateScreenProps {
  user: User;
  gateState: AccessGateState;
  errorMessage?: string | null;
  pendingInviteCode?: string | null;
  pendingChantierId?: string | null;
  onActivated: (record: AccessUserRecord) => void;
  onDossierReaderActivated: (chantierId: string) => void;
  onPendingCreated: (record: AccessUserRecord) => void;
  onRetryCheck: () => Promise<void>;
  onNotify: (msg: string, tone?: 'default' | 'success' | 'error') => void;
}

export function AccessGateScreen({
  user,
  gateState,
  errorMessage,
  pendingInviteCode,
  pendingChantierId,
  onActivated,
  onDossierReaderActivated,
  onPendingCreated,
  onRetryCheck,
  onNotify,
}: AccessGateScreenProps) {
  const [personalCode, setPersonalCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [dossierInput, setDossierInput] = useState(pendingChantierId || '');
  const [dossierCode, setDossierCode] = useState('');
  const [dossierBusy, setDossierBusy] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [showDossierPanel, setShowDossierPanel] = useState(
    Boolean(pendingChantierId)
  );
  const [showColleaguePanel, setShowColleaguePanel] = useState(
    !pendingChantierId
  );

  useEffect(() => {
    if (pendingChantierId) {
      setDossierInput(pendingChantierId);
      setShowDossierPanel(true);
      setShowColleaguePanel(false);
    }
  }, [pendingChantierId]);

  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleaned = personalCode.trim();
    if (cleaned.length < 3 || cleaned.length > 32) {
      setFormError(
        'Le code personnel doit contenir entre 3 et 32 caractères.'
      );
      return;
    }

    setBusy(true);
    try {
      const approved = await activateWithPersonalCode(user, cleaned);
      onNotify('Accès activé sur cet appareil !', 'success');
      onActivated(approved);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Impossible de valider ce code personnel.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRedeemDossierPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setDossierError(null);
    const target = (dossierInput || pendingChantierId || '').trim();
    const digits = dossierCode.replace(/\D/g, '');
    if (!target) {
      setDossierError(
        'Collez le lien complet reçu par e-mail (ou l’identifiant du chantier).'
      );
      return;
    }
    if (digits.length !== 6) {
      setDossierError(
        'Le code d’accès du dossier doit comporter exactement 6 chiffres.'
      );
      return;
    }

    setDossierBusy(true);
    try {
      const res = await redeemDossierPinCode(target, digits, user);
      onNotify(
        `Accès lecture & signature activé pour « ${res.chantierProjet} ».`,
        'success'
      );
      onDossierReaderActivated(res.chantierId);
    } catch (err) {
      setDossierError(
        err instanceof Error
          ? err.message
          : 'Impossible de déverrouiller ce dossier avec ce code à 6 chiffres.'
      );
    } finally {
      setDossierBusy(false);
    }
  };

  const handleRequestAccess = async () => {
    setFormError(null);
    setBusy(true);
    try {
      const pendingRecord = await requestAccessWithoutCode(user);
      onNotify(
        "Demande d'accès envoyée à l'administrateur.",
        'success'
      );
      onPendingCreated(pendingRecord);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer votre demande."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6f9] flex flex-col justify-between px-4 py-8">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden">
          <div className="bg-[#0a5b9c] text-white px-6 py-4 flex items-center gap-3">
            <AppLogo className="w-10 h-10 rounded-xl shrink-0" />
            <div className="min-w-0">
              <div className="text-base font-extrabold leading-tight truncate">
                Mes JDT
              </div>
              <div className="text-xs text-white/80 truncate">{user.email}</div>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {pendingInviteCode &&
              (gateState === 'needs_code' || gateState === 'pending') && (
                <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200 text-xs text-blue-950 leading-relaxed">
                  Invitation de dossier détectée (
                  <span className="font-mono font-bold">{pendingInviteCode}</span>
                  ). Dès que votre appareil est activé par l&apos;administrateur
                  (code personnel ou validation ci-dessous), le dossier partagé
                  s&apos;ouvrira automatiquement.
                </div>
              )}

            {/* Revoked State — ONLY Changer de compte button */}
            {gateState === 'revoked' && (
              <div className="text-center space-y-4 py-2">
                <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Accès non autorisé
                  </h2>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                    L&apos;accès pour ce compte sur cet appareil a été révoqué ou
                    refusé par l&apos;administrateur.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => signOut(auth)}
                  className="w-full min-h-[46px] rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Changer de compte
                </button>
              </div>
            )}

            {/* Offline before first activation */}
            {gateState === 'offline_unapproved' && (
              <div className="text-center space-y-4 py-2">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
                  <WifiOff className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Connexion Internet requise
                  </h2>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                    C&apos;est la première connexion de cet appareil. Une
                    connexion Internet est nécessaire pour activer votre accès.
                    Ensuite, l&apos;application restera utilisable hors-ligne.
                  </p>
                </div>
                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onRetryCheck();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full min-h-[46px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`}
                    />
                    Réessayer
                  </button>
                  <button
                    type="button"
                    onClick={() => signOut(auth)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold cursor-pointer"
                  >
                    Changer de compte
                  </button>
                </div>
              </div>
            )}

            {/* Quota Exceeded */}
            {gateState === 'quota_exceeded' && (
              <div className="text-center space-y-4 py-2">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Quota gratuit quotidien dépassé
                  </h2>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                    {errorMessage ||
                      'Le quota gratuit quotidien de la base Firestore est momentanément atteint. Il se réinitialisera automatiquement demain.'}
                  </p>
                </div>
                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onRetryCheck();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full min-h-[46px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`}
                    />
                    Réessayer
                  </button>
                  <a
                    href={FIRESTORE_QUOTA_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full min-h-[42px] rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Consulter le quota Firebase Spark
                  </a>
                  <button
                    type="button"
                    onClick={() => signOut(auth)}
                    className="w-full min-h-[40px] text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    Changer de compte
                  </button>
                </div>
              </div>
            )}

            {/* Main Access Options (Single-Dossier Entrepreneur Code + Colleague Personal Code) */}
            {(gateState === 'needs_code' || gateState === 'pending') && (
              <>
                {showDossierPanel ? (
                  <div className="rounded-2xl border border-[#0a5b9c]/25 bg-[#0a5b9c]/[0.03] p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center shrink-0 mt-0.5">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Accès au dossier partagé (lecture &amp; signature)
                        </h2>
                        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                          Entrez le <strong>code d&apos;accès à 6 chiffres</strong>{' '}
                          figurant dans l&apos;e-mail d&apos;invitation pour
                          consulter et signer <strong>ce chantier uniquement</strong>.
                        </p>
                      </div>
                    </div>

                    <form onSubmit={handleRedeemDossierPin} className="space-y-3">
                      {!pendingChantierId ? (
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                            Lien ou identifiant du dossier
                          </label>
                          <input
                            type="text"
                            value={dossierInput}
                            onChange={(e) => setDossierInput(e.target.value)}
                            placeholder="Collez le lien reçu par e-mail"
                            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
                          />
                        </div>
                      ) : (
                        <div className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
                          <FolderOpen className="w-3.5 h-3.5 text-[#0a5b9c] shrink-0" />
                          <span className="truncate">
                            Dossier détecté :{' '}
                            <span className="font-mono font-semibold text-slate-800">
                              {pendingChantierId}
                            </span>
                          </span>
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Code d&apos;accès à 6 chiffres (reçu par e-mail)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={dossierCode}
                          onChange={(e) =>
                            setDossierCode(
                              e.target.value.replace(/\D/g, '').slice(0, 6)
                            )
                          }
                          placeholder="ex. 482910"
                          autoComplete="one-time-code"
                          className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-200 bg-white font-mono text-lg font-bold tracking-[0.25em] text-center text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
                        />
                      </div>

                      {dossierError && (
                        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{dossierError}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={
                          dossierBusy ||
                          dossierCode.replace(/\D/g, '').length !== 6
                        }
                        className="w-full min-h-[46px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                      >
                        <KeyRound className="w-4 h-4" />
                        {dossierBusy
                          ? 'Vérification du dossier…'
                          : 'Ouvrir ce dossier'}
                      </button>
                    </form>

                    {!pendingChantierId && (
                      <button
                        type="button"
                        onClick={() => setShowDossierPanel(false)}
                        className="w-full text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        Masquer l&apos;accès par dossier
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDossierPanel(true);
                      setShowColleaguePanel(false);
                    }}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-[#0a5b9c]/30 bg-[#0a5b9c]/[0.04] hover:bg-[#0a5b9c]/10 text-[#0a5b9c] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Entrepreneur invité sur un chantier ? Entrer un code à 6 chiffres
                  </button>
                )}

                {pendingChantierId && !showColleaguePanel ? (
                  <button
                    type="button"
                    onClick={() => setShowColleaguePanel(true)}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    Vous êtes collègue INASEP ? Validation par code personnel
                  </button>
                ) : (
                  <div className="space-y-4 pt-1">
                    {gateState === 'pending' && (
                      <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 space-y-2.5">
                        <div className="flex items-start gap-2.5">
                          <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                          <div className="text-xs text-amber-950 leading-relaxed">
                            <strong>Demande en attente</strong> : votre fiche a
                            bien été transmise à l&apos;administrateur. Dès
                            qu&apos;il vous autorise, cliquez sur Actualiser (ou
                            saisissez votre code personnel ci-dessous).
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await onRetryCheck();
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="w-full min-h-[40px] rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`}
                          />
                          Actualiser
                        </button>
                      </div>
                    )}

                    <div className="space-y-1">
                      <h2 className="text-base font-bold text-slate-900">
                        Validation par code personnel (collègues INASEP)
                      </h2>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Réservé aux collègues INASEP disposant d&apos;un accès
                        complet. Saisissez le code personnel fourni par
                        l&apos;administrateur.
                      </p>
                    </div>

                    <form onSubmit={handleValidateCode} className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Code personnel
                        </label>
                        <input
                          type="text"
                          value={personalCode}
                          onChange={(e) => setPersonalCode(e.target.value)}
                          placeholder="Ex. INASEP-2026"
                          autoComplete="one-time-code"
                          className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-200 bg-slate-50 font-mono text-base tracking-wider text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:bg-white"
                        />
                      </div>

                      {formError && (
                        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{formError}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={busy || personalCode.trim().length < 3}
                        className="w-full min-h-[46px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                      >
                        <KeyRound className="w-4 h-4" />
                        Activer cet appareil
                      </button>
                    </form>

                    {gateState === 'needs_code' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleRequestAccess}
                        className="w-full min-h-[42px] rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer disabled:opacity-60"
                      >
                        Pas encore de code ? Demander l&apos;accès collègue
                      </button>
                    )}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => signOut(auth)}
                    className="w-full min-h-[38px] text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Changer de compte
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="text-center text-xs text-slate-500 mt-6">
        Mes JDT · INASEP · <strong>{APP_SIGNATURE}</strong>
      </footer>
    </div>
  );
}

