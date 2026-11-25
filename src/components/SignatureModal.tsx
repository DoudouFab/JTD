import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Fingerprint,
  Info,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import type { Chantier, Journal } from '../types';
import { fmtDateFR } from '../utils/dates';
import {
  checkWebEidStatus,
  createHardwareEidSession,
  createVerifiedSigningSession,
  formatSignatureMethodLabel,
  isWebAuthnSupported,
  type SigningSessionMode,
  type VerifiedSigningSession,
  type WebEidStatusInfo,
} from '../utils/signatureCrypto';

interface SignatureModalProps {
  open: boolean;
  role: 'controleur' | 'lecteur';
  chantier: Chantier;
  defaultSignerName: string;
  signerEmail: string;
  signerUid: string;
  getIdToken: () => Promise<string>;
  targetLabel: string;
  targetJournals: Journal[];
  existingSession: VerifiedSigningSession | null;
  onSessionVerified: (session: VerifiedSigningSession | null) => void;
  onConfirmSign: (
    session: VerifiedSigningSession,
    journalsToSign: Journal[],
    onProgress?: (current: number, total: number, journal: Journal) => void
  ) => Promise<void>;
  onClose: () => void;
}

export function SignatureModal({
  open,
  role,
  chantier,
  defaultSignerName,
  signerEmail,
  signerUid,
  getIdToken,
  targetLabel,
  targetJournals,
  existingSession,
  onSessionVerified,
  onConfirmSign,
  onClose,
}: SignatureModalProps) {
  const [mode, setMode] = useState<SigningSessionMode>(
    existingSession?.mode || 'hardware_eid'
  );
  const [signerName, setSignerName] = useState(
    existingSession?.signerName || defaultSignerName
  );
  const [nationalIdRaw, setNationalIdRaw] = useState('');
  const [useWebAuthn, setUseWebAuthn] = useState(isWebAuthnSupported());
  const [webEidStatus, setWebEidStatus] = useState<WebEidStatusInfo | null>(
    null
  );
  const [checkingReader, setCheckingReader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runReaderCheck = async () => {
    setCheckingReader(true);
    try {
      const status = await checkWebEidStatus();
      setWebEidStatus(status);
    } finally {
      setCheckingReader(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setProgressText(null);
    if (existingSession) {
      setMode(existingSession.mode);
    }
    void runReaderCheck();
  }, [open, existingSession]);

  if (!open) return null;

  const webAuthnAvailable = isWebAuthnSupported();
  const roleLabel =
    role === 'controleur'
      ? 'Contrôleur responsable (INASEP)'
      : 'Entrepreneur / Lecteur autorisé';

  const unsignedTarget = targetJournals.filter((j) =>
    role === 'controleur' ? !j.signatureControleur : !j.signatureLecteur
  );

  const handleVerifyAndSign = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setProgressText(null);

    if (!unsignedTarget.length) {
      setErrorMsg(
        'Toutes les pages sélectionnées sont déjà signées pour ce rôle.'
      );
      return;
    }

    if (
      mode === 'account_fallback' &&
      !existingSession &&
      !signerName.trim()
    ) {
      setErrorMsg('Veuillez confirmer votre nom et prénom complets.');
      return;
    }

    setBusy(true);
    try {
      let session = existingSession;
      if (!session || session.mode !== mode) {
        if (mode === 'hardware_eid') {
          setProgressText(
            'Lecture de la carte eID (confirmez la lecture si demandé)…'
          );
          session = await createHardwareEidSession({
            signerUid,
            signerEmail,
            chantier,
            sampleJournal: unsignedTarget[0],
            getIdToken,
          });
        } else {
          session = await createVerifiedSigningSession({
            method: 'eid',
            signerUid,
            signerName: signerName.trim(),
            signerEmail,
            nationalIdRaw,
            useWebAuthn,
          });
        }
        onSessionVerified(session);
      }

      await onConfirmSign(
        session,
        unsignedTarget,
        (current, total, currentJournal) => {
          if (session?.mode === 'hardware_eid') {
            setProgressText(
              `Page ${current}/${total} (Journal N° ${currentJournal.journalNum}) : veuillez saisir votre code PIN eID…`
            );
          } else {
            setProgressText(
              `Scellement page ${current}/${total} (Journal N° ${currentJournal.journalNum})…`
            );
          }
        }
      );
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Impossible de finaliser la signature.'
      );
    } finally {
      setBusy(false);
      setProgressText(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sig-modal-title"
    >
      <div className="w-full max-w-lg max-h-[92vh] bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2
              id="sig-modal-title"
              className="text-base font-bold text-slate-900 flex items-center gap-2"
            >
              <ShieldCheck className="w-5 h-5 text-[#0a5b9c]" />
              Signature électronique e-ID
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {roleLabel} · {targetLabel}
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

        <form
          onSubmit={handleVerifyAndSign}
          className="overflow-y-auto p-5 space-y-4"
        >
          {/* Pages summary */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
            <div className="text-xs font-bold text-slate-700">
              {unsignedTarget.length} page{unsignedTarget.length > 1 ? 's' : ''}{' '}
              à signer :
            </div>
            <div className="flex flex-wrap gap-1.5">
              {unsignedTarget.map((j) => (
                <span
                  key={j.id}
                  className="text-[11px] font-mono font-semibold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700"
                >
                  J{j.journalNum} ({fmtDateFR(j.date)})
                </span>
              ))}
            </div>
          </div>

          {existingSession ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  Session active (
                  {formatSignatureMethodLabel(
                    existingSession.method,
                    existingSession.hardwareVerified
                  )}
                  )
                </div>
                <button
                  type="button"
                  onClick={() => onSessionVerified(null)}
                  className="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer"
                >
                  Changer
                </button>
              </div>
              <p className="text-xs text-emerald-800">
                Signataire : <strong>{existingSession.signerName}</strong> · Réf.{' '}
                <span className="font-mono">{existingSession.verificationId}</span>
              </p>
              {existingSession.mode === 'hardware_eid' ? (
                <p className="text-[11px] text-emerald-700">
                  Certificat :{' '}
                  <span className="font-mono">
                    {existingSession.certSerial}
                  </span>{' '}
                  ({existingSession.certIssuer}). Votre code PIN eID sera
                  demandé par votre lecteur pour sceller chaque page.
                </p>
              ) : (
                <p className="text-[11px] text-emerald-700">
                  Votre vérification de session est active pour sceller ces pages.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Mode Switcher */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('hardware_eid');
                    setErrorMsg(null);
                  }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    mode === 'hardware_eid'
                      ? 'border-[#0a5b9c] bg-[#0a5b9c]/[0.06] ring-1 ring-[#0a5b9c]'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <CreditCard className="w-4 h-4 text-[#0a5b9c] shrink-0" />
                    Carte eID physique
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Lecteur USB PC + code PIN (Web-eID)
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode('account_fallback');
                    setErrorMsg(null);
                  }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    mode === 'account_fallback'
                      ? 'border-[#0a5b9c] bg-[#0a5b9c]/[0.06] ring-1 ring-[#0a5b9c]'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <Smartphone className="w-4 h-4 text-slate-600 shrink-0" />
                    Sans lecteur PC
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Compte authentifié + WebAuthn
                  </div>
                </button>
              </div>

              {mode === 'hardware_eid' ? (
                <div className="space-y-3">
                  {/* Live Web-eID Reader Status */}
                  <div
                    className={`rounded-xl border p-3.5 text-xs space-y-2 ${
                      webEidStatus?.available
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                        : 'border-amber-200 bg-amber-50 text-amber-950'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold flex items-center gap-1.5">
                        {checkingReader ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Détection du lecteur Web-eID…
                          </>
                        ) : webEidStatus?.available ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                            Lecteur Web-eID prêt
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                            Extension ou lecteur Web-eID non détecté
                          </>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={checkingReader}
                        onClick={() => void runReaderCheck()}
                        className="text-[11px] font-semibold underline cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        Retester
                      </button>
                    </div>

                    {webEidStatus?.available ? (
                      <p className="text-[11px] text-emerald-800">
                        Extension Web-eID v{webEidStatus.extension || '?'} ·
                        Application PC v{webEidStatus.nativeApp || '?'}.
                        Insérez votre carte eID belge dans le lecteur : le nom
                        et le certificat de signature (non-répudiation) seront
                        lus directement depuis la puce et vérifiés côté serveur.
                      </p>
                    ) : (
                      <div className="text-[11px] space-y-1.5 leading-relaxed">
                        <p>{webEidStatus?.message}</p>
                        <p className="text-amber-900">
                          Prérequis PC :{' '}
                          <a
                            href="https://eid.belgium.be"
                            target="_blank"
                            rel="noreferrer"
                            className="underline font-semibold"
                          >
                            Middleware eID Belgique
                          </a>{' '}
                          +{' '}
                          <a
                            href="https://web-eid.eu"
                            target="_blank"
                            rel="noreferrer"
                            className="underline font-semibold"
                          >
                            Web-eID (extension + appli PC)
                          </a>
                          .
                        </p>
                        {webEidStatus?.inIframe && (
                          <p className="font-semibold text-amber-950">
                            Remarque : vous êtes actuellement dans un cadre
                            intégré (iframe), où certains navigateurs bloquent
                            l&apos;extension Web-eID. Ouvrez l&apos;URL
                            directement dans un onglet Chrome ou Edge sur PC, ou
                            utilisez le mode « Sans lecteur PC » sur
                            tablette/mobile.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-[11px] text-blue-900 flex items-start gap-2 leading-relaxed">
                    <Info className="w-4 h-4 text-[#0a5b9c] shrink-0 mt-0.5" />
                    <span>
                      Votre carte eID signe avec la clé de{' '}
                      <strong>Signature (Non-répudiation)</strong> l&apos;empreinte
                      SHA-256 exacte de chaque page. Le serveur vérifie
                      cryptographiquement la signature, la chaîne belge (Citizen
                      CA) et le statut OCSP avant enregistrement.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Nom et prénom du signataire
                    </label>
                    <input
                      type="text"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="ex. Fabien Pirquin"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      N° de carte eID / Registre national (optionnel, haché
                      SHA-256)
                    </label>
                    <input
                      type="text"
                      value={nationalIdRaw}
                      onChange={(e) => setNationalIdRaw(e.target.value)}
                      placeholder="Non conservé en clair (empreinte SHA-256 uniquement)"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
                    />
                  </div>

                  {webAuthnAvailable && (
                    <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/70 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useWebAuthn}
                        onChange={(e) => setUseWebAuthn(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[#0a5b9c]"
                      />
                      <div className="text-xs text-slate-700">
                        <span className="font-semibold flex items-center gap-1.5">
                          <Fingerprint className="w-3.5 h-3.5 text-[#0a5b9c]" />
                          Confirmer par sécurité biométrique / code appareil
                          (WebAuthn)
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          Renforce la vérification sur mobile ou tablette.
                        </span>
                      </div>
                    </label>
                  )}

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 flex items-start gap-2 leading-relaxed">
                    <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <span>
                      Mode de secours sans lecteur PC : l&apos;accord est scellé
                      par SHA-256 + ECDSA P-256 lié à votre compte connecté
                      (mentionné « e-ID (compte) » dans les détails).
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {progressText && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#0a5b9c] shrink-0" />
              <span>{progressText}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              {errorMsg}
            </div>
          )}

          <div className="pt-1 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="min-h-[44px] px-5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={busy || unsignedTarget.length === 0}
              className="min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <ShieldCheck className="w-4 h-4" />
              {busy
                ? 'Signature en cours…'
                : mode === 'hardware_eid'
                  ? `Signer avec carte eID (${unsignedTarget.length}p)`
                  : existingSession
                    ? `Signer (${unsignedTarget.length} page${unsignedTarget.length > 1 ? 's' : ''})`
                    : 'Vérifier & signer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
