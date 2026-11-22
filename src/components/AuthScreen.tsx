import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { auth, googleProvider } from '../firebase';
import { APP_SIGNATURE } from '../types';
import { AppLogo } from './AppLogo';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthScreenProps {
  unverifiedUser: User | null;
  onVerifiedRefresh: () => Promise<boolean>;
}

function mapAuthError(err: unknown): {
  message: string;
  needsProviderSetup?: boolean;
} {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/operation-not-allowed':
      return {
        message:
          "Ce mode de connexion n'est pas encore activé dans Firebase Console (Authentication → Sign-in method).",
        needsProviderSetup: true,
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return { message: 'Adresse e-mail ou mot de passe incorrect.' };
    case 'auth/email-already-in-use':
      return {
        message:
          'Un compte existe déjà avec cette adresse e-mail. Passez en mode « Déjà inscrit ».',
      };
    case 'auth/weak-password':
      return {
        message: 'Le mot de passe doit contenir au moins 6 caractères.',
      };
    case 'auth/invalid-email':
      return { message: 'Adresse e-mail invalide.' };
    case 'auth/too-many-requests':
      return {
        message:
          "Trop de tentatives ou un e-mail vient déjà d'être envoyé. Patientez 1 minute et vérifiez vos spams.",
      };
    case 'auth/network-request-failed':
      return {
        message:
          'Connexion réseau impossible. Vérifiez votre accès Internet et réessayez.',
      };
    case 'auth/unauthorized-domain':
      return {
        message:
          "Ce domaine n'est pas encore autorisé dans Firebase (Authentication → Settings → Domaines autorisés).",
      };
    case 'auth/user-token-expired':
    case 'auth/requires-recent-login':
      return {
        message:
          'Votre session a expiré. Cliquez sur « Autre compte » puis reconnectez-vous.',
      };
    case 'auth/popup-closed-by-user':
      return { message: 'Connexion Google annulée.' };
    default:
      return {
        message:
          err instanceof Error
            ? err.message
            : "Impossible d'effectuer la connexion.",
      };
  }
}

export function AuthScreen({
  unverifiedUser,
  onVerifiedRefresh,
}: AuthScreenProps) {
  const [authTab, setAuthTab] = useState<'google' | 'pro'>('google');
  const [proMode, setProMode] = useState<'first' | 'existing'>('first');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsProviderSetup, setNeedsProviderSetup] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setNeedsProviderSetup(false);
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const mapped = mapAuthError(err);
      setErrorMsg(mapped.message);
      setNeedsProviderSetup(Boolean(mapped.needsProviderSetup));
    } finally {
      setBusy(false);
    }
  };

  const handleProEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setNeedsProviderSetup(false);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMsg('Renseignez votre adresse e-mail pro et votre mot de passe.');
      return;
    }

    if (proMode === 'first' && password.length < 6) {
      setErrorMsg('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    setBusy(true);
    try {
      if (proMode === 'first') {
        const cred = await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          password
        );
        await sendEmailVerification(cred.user);
        setInfoMsg(
          'Compte créé ! Un e-mail de confirmation vient d’être envoyé.'
        );
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
      }
    } catch (err) {
      const mapped = mapAuthError(err);
      setErrorMsg(mapped.message);
      setNeedsProviderSetup(Boolean(mapped.needsProviderSetup));
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg(
        'Saisissez d’abord votre adresse e-mail pro pour recevoir le lien.'
      );
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfoMsg(
        `Un e-mail de réinitialisation du mot de passe a été envoyé à ${cleanEmail}.`
      );
    } catch (err) {
      const mapped = mapAuthError(err);
      setErrorMsg(mapped.message);
      setNeedsProviderSetup(Boolean(mapped.needsProviderSetup));
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    const targetUser = auth.currentUser || unverifiedUser;
    if (!targetUser) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await sendEmailVerification(targetUser);
      setInfoMsg(
        'E-mail de confirmation renvoyé. Vérifiez aussi votre dossier Courriers indésirables.'
      );
    } catch (err) {
      setErrorMsg(mapAuthError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const handleContinueAfterVerify = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const verified = await onVerifiedRefresh();
      if (!verified) {
        setErrorMsg(
          "Votre e-mail n'est pas encore confirmé. Cliquez sur le lien reçu dans votre boîte mail puis réessayez."
        );
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6f9] flex flex-col justify-between px-4 py-8">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden">
          {/* Brand Header */}
          <div className="bg-[#0a5b9c] text-white px-6 py-5 flex items-center gap-3.5">
            <AppLogo className="w-11 h-11 rounded-xl shrink-0 shadow-xs" />
            <div>
              <h1 className="text-lg font-extrabold tracking-tight leading-tight">
                Mes JDT
              </h1>
              <p className="text-xs text-white/80 mt-0.5">
                Journal des travaux · INASEP
              </p>
            </div>
          </div>

          {/* Unverified Corporate Email Screen */}
          {unverifiedUser ? (
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <MailCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Confirmez votre e-mail pro
                  </h2>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Un lien de confirmation a été envoyé à{' '}
                    <strong className="text-slate-900">
                      {unverifiedUser.email}
                    </strong>
                    . Cliquez sur ce lien dans votre messagerie avant de
                    poursuivre.
                  </p>
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {infoMsg && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{infoMsg}</span>
                </div>
              )}

              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleContinueAfterVerify}
                  className="w-full min-h-[46px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                  J&apos;ai cliqué sur le lien — Continuer
                </button>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleResendVerification}
                    className="text-xs font-semibold text-[#0a5b9c] hover:underline cursor-pointer disabled:opacity-60"
                  >
                    Renvoyer l&apos;e-mail
                  </button>
                  <button
                    type="button"
                    onClick={() => signOut(auth)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Autre compte
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {/* Primary 2-Tab Selector: Compte Google / E-mail pro */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('google');
                    setErrorMsg(null);
                    setInfoMsg(null);
                    setNeedsProviderSetup(false);
                  }}
                  className={`min-h-[42px] rounded-lg text-sm font-bold cursor-pointer transition-all ${
                    authTab === 'google'
                      ? 'bg-white text-[#0a5b9c] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Compte Google
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('pro');
                    setErrorMsg(null);
                    setInfoMsg(null);
                    setNeedsProviderSetup(false);
                  }}
                  className={`min-h-[42px] rounded-lg text-sm font-bold cursor-pointer transition-all ${
                    authTab === 'pro'
                      ? 'bg-white text-[#0a5b9c] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  E-mail pro
                </button>
              </div>

              {authTab === 'google' ? (
                <div className="space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Connectez-vous en un clic avec votre compte Google. Une
                    seule validation par code personnel est demandée sur cet
                    appareil.
                  </p>

                  {errorMsg && (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGoogleLogin}
                    className="w-full min-h-[48px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-bold text-sm flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60"
                  >
                    <svg
                      className="w-4 h-4 bg-white rounded-full p-0.5"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                      />
                    </svg>
                    Se connecter avec Google
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Pro Sub-mode: 1re connexion / Déjà inscrit */}
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setProMode('first');
                        setErrorMsg(null);
                        setInfoMsg(null);
                      }}
                      className={`flex-1 min-h-[36px] rounded-lg text-xs font-bold cursor-pointer transition-all ${
                        proMode === 'first'
                          ? 'bg-[#0a5b9c] text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      1re connexion
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProMode('existing');
                        setErrorMsg(null);
                        setInfoMsg(null);
                      }}
                      className={`flex-1 min-h-[36px] rounded-lg text-xs font-bold cursor-pointer transition-all ${
                        proMode === 'existing'
                          ? 'bg-[#0a5b9c] text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Déjà inscrit
                    </button>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    {proMode === 'first'
                      ? 'Pour les adresses professionnelles non-Google (Exchange / Outlook, ex. @inasep.be). Un e-mail de confirmation sera envoyé.'
                      : 'Connectez-vous avec votre adresse professionnelle déjà confirmée.'}
                  </p>

                  <form onSubmit={handleProEmailSubmit} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                        E-mail professionnel
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="prenom.nom@inasep.be"
                          autoComplete="email"
                          className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Mot de passe
                        </label>
                        {proMode === 'existing' && (
                          <button
                            type="button"
                            onClick={handlePasswordReset}
                            className="text-xs font-semibold text-[#0a5b9c] hover:underline cursor-pointer"
                          >
                            Mot de passe oublié ?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={
                            proMode === 'first'
                              ? 'Minimum 6 caractères'
                              : 'Votre mot de passe'
                          }
                          autoComplete={
                            proMode === 'existing'
                              ? 'current-password'
                              : 'new-password'
                          }
                          className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          className="absolute right-0 top-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label="Afficher ou masquer le mot de passe"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {errorMsg && (
                      <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{errorMsg}</span>
                        </div>
                        {needsProviderSetup && (
                          <ol className="list-decimal pl-5 space-y-0.5 text-[11px] text-red-900/90">
                            <li>
                              Ouvrez Firebase Console →{' '}
                              <strong>Authentication → Sign-in method</strong>.
                            </li>
                            <li>
                              Activez{' '}
                              <strong>Adresse e-mail / Mot de passe</strong> et{' '}
                              <strong>Google</strong>.
                            </li>
                          </ol>
                        )}
                      </div>
                    )}

                    {infoMsg && (
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{infoMsg}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full min-h-[46px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      <KeyRound className="w-4 h-4" />
                      {proMode === 'first'
                        ? 'Créer mon compte et vérifier l’e-mail'
                        : 'Se connecter'}
                    </button>
                  </form>
                </div>
              )}

              <div className="space-y-3 pt-1 border-t border-slate-100">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <ShieldCheck className="w-4 h-4 text-[#0a5b9c] shrink-0" />
                  <span>
                    Connexion unique par appareil et synchronisation sur toutes
                    vos plateformes.
                  </span>
                </div>
                <PWAInstallButton variant="card" />
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="text-center text-xs text-slate-500 mt-6">
        Mes JDT · INASEP · <strong>{APP_SIGNATURE}</strong>
      </footer>
    </div>
  );
}
