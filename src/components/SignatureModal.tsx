import { useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Fingerprint,
  Info,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { Journal } from '../types';
import { fmtDateFR } from '../utils/dates';
import {
  createVerifiedSigningSession,
  formatSignatureMethodLabel,
  isWebAuthnSupported,
  type VerifiedSigningSession,
} from '../utils/signatureCrypto';

interface SignatureModalProps {
  open: boolean;
  role: 'controleur' | 'lecteur';
  defaultSignerName: string;
  signerEmail: string;
  signerUid: string;
  targetLabel: string;
  targetJournals: Journal[];
  existingSession: VerifiedSigningSession | null;
  onSessionVerified: (session: VerifiedSigningSession) => void;
  onConfirmSign: (
    session: VerifiedSigningSession,
    journalsToSign: Journal[]
  ) => Promise<void>;
  onClose: () => void;
}

export function SignatureModal({
  open,
  role,
  defaultSignerName,
  signerEmail,
  signerUid,
  targetLabel,
  targetJournals,
  existingSession,
  onSessionVerified,
  onConfirmSign,
  onClose,
}: SignatureModalProps) {
  const method = 'eid' as const;
  const [signerName, setSignerName] = useState(
    existingSession?.signerName || defaultSignerName
  );
  const [nationalIdRaw, setNationalIdRaw] = useState('');
  const [useWebAuthn, setUseWebAuthn] = useState(isWebAuthnSupported());
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const webAuthnAvailable = isWebAuthnSupported();
  const roleLabel =
    role === 'controleur'
      ? 'Contrôleur responsable (INASEP)'
      : 'Lecteur autorisé (accès temporaire)';

  const unsignedTarget = targetJournals.filter((j) =>
    role === 'controleur' ? !j.signatureControleur : !j.signatureLecteur
  );

  const handleVerifyAndSign = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!existingSession && !signerName.trim()) {
      setErrorMsg('Veuillez confirmer votre nom et prénom complets.');
      return;
    }
    if (!unsignedTarget.length) {
      setErrorMsg('Toutes les pages sélectionnées sont déjà signées pour ce rôle.');
      return;
    }

    setBusy(true);
    try {
      let session = existingSession;
      if (!session) {
        session = await createVerifiedSigningSession({
          method,
          signerUid,
          signerName: signerName.trim(),
          signerEmail,
          nationalIdRaw,
          useWebAuthn,
        });
        onSessionVerified(session);
      }
      await onConfirmSign(session, unsignedTarget);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Impossible de finaliser la signature.'
      );
    } finally {
      setBusy(false);
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
              Signature authentifiée (1 vérification)
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
              à signer (1 signature par page) :
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
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                Vérification d&apos;identité active ({formatSignatureMethodLabel(existingSession.method)})
              </div>
              <p className="text-xs text-emerald-800">
                Signataire : <strong>{existingSession.signerName}</strong> · Réf.{' '}
                <span className="font-mono">{existingSession.verificationId}</span>
              </p>
              <p className="text-[11px] text-emerald-700">
                Votre unique vérification de session reste active : aucune
                nouvelle authentification n&apos;est nécessaire pour signer ces
                pages.
              </p>
            </div>
          ) : (
            <>
              {/* Identification method (e-ID) */}
              <div className="rounded-xl border border-[#0a5b9c]/30 bg-[#0a5b9c]/[0.04] p-3 flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-[#0a5b9c] shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    Signature électronique e-ID
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Scellement SHA-256 + ECDSA P-256 lié à votre compte authentifié
                  </div>
                </div>
              </div>

              {/* Identity fields */}
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
                    N° de carte eID / Registre national (optionnel, haché SHA-256)
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
                        Confirmer par sécurité biométrique / code appareil (WebAuthn)
                      </span>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        Renforce la vérification d&apos;identité avant signature.
                      </span>
                    </div>
                  </label>
                )}
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-[11px] text-blue-900 flex items-start gap-2 leading-relaxed">
                <Info className="w-4 h-4 text-[#0a5b9c] shrink-0 mt-0.5" />
                <span>
                  L&apos;application génère une empreinte cryptographique
                  SHA-256 + ECDSA P-256 propre à chaque page signée et l&apos;inscrit
                  dans les métadonnées du PDF. Une lecture directe avec code PIN
                  via un lecteur USB sur PC requiert un module local (ex. Web-eID)
                  ou une passerelle HTTPS serveur mTLS.
                </span>
              </div>
            </>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              {errorMsg}
            </div>
          )}

          <div className="pt-1 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 cursor-pointer"
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
                ? 'Vérification et signature…'
                : existingSession
                  ? `Signer (${unsignedTarget.length} page${unsignedTarget.length > 1 ? 's' : ''})`
                  : 'Vérifier (e-ID) & signer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
