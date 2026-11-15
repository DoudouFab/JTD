import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { auth, googleProvider } from '../firebase';
import { APP_SIGNATURE, DEFAULT_ADMIN_EMAIL, INASEP_LOGO_DATA_URL } from '../types';

interface AuthScreenProps {
  unverifiedUser: User | null;
  onVerifiedRefresh: () => Promise<void>;
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
          "La connexion par E-mail / Mot de passe n'est pas encore activée dans votre console Firebase (Authentification > Sign-in method). Vous pouvez l'activer ou utiliser « Continuer avec Google » ci-dessous.",
        needsProviderSetup: true,
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return { message: 'Adresse e-mail ou mot de passe incorrect.' };
    case 'auth/email-already-in-use':
      return { message: 'Un compte existe déjà avec cette adresse e-mail.' };
    case 'auth/weak-password':
      return {
        message: 'Le mot de passe doit contenir au moins 6 caractères (exigence Firebase).',
      };
    case 'auth/invalid-email':
      return { message: 'Adresse e-mail invalide.' };
    case 'auth/too-many-requests':
      return {
        message:
          'Trop de tentatives. Patientez quelques instants avant de réessayer.',
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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('Fabien Pirquin');
  const [email, setEmail] = useState(DEFAULT_ADMIN_EMAIL);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsProviderSetup, setNeedsProviderSetup] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setNeedsProviderSetup(false);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMsg('Veuillez renseigner votre adresse e-mail et votre mot de passe.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
      } else {
        if (!displayName.trim()) {
          setErrorMsg('Veuillez indiquer votre nom complet.');
          setBusy(false);
          return;
        }
        if (password.length < 6) {
          setErrorMsg(
            'Le mot de passe doit comporter au moins 6 caractères (vous pourrez le modifier à tout moment dans l’onglet Compte).'
          );
          setBusy(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          password
        );
        await updateProfile(cred.user, { displayName: displayName.trim() });
        await sendEmailVerification(cred.user);
        setInfoMsg(
          'Compte créé ! Un lien de vérification vient d’être envoyé à votre adresse e-mail.'
        );
      }
    } catch (err) {
      const mapped = mapAuthError(err);
      setErrorMsg(mapped.message);
      setNeedsProviderSetup(Boolean(mapped.needsProviderSetup));
    } finally {
      setBusy(false);
    }
  };

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
        'Saisissez d’abord votre adresse e-mail pour recevoir le lien de réinitialisation.'
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
    if (!unverifiedUser) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await sendEmailVerification(unverifiedUser);
      setInfoMsg('E-mail de vérification renvoyé. Vérifiez votre boîte de réception.');
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
          {/* Brand Banner */}
          <div className="bg-[#0a5b9c] text-white px-6 py-5 flex items-center gap-3.5">
            <img
              src={INASEP_LOGO_DATA_URL}
              alt="INASEP"
              className="h-10 w-auto rounded-lg bg-white px-2 py-1 shrink-0"
            />
            <div>
              <h1 className="text-lg font-extrabold tracking-tight leading-tight">
                Journal des travaux
              </h1>
              <p className="text-xs text-white/80 mt-0.5">INASEP</p>
            </div>
          </div>

          {/* Body */}
          {unverifiedUser ? (
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <MailCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Vérification de votre adresse e-mail
                  </h2>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Pour sécuriser l&apos;accès multi-appareils, cliquez sur le
                    lien envoyé à{' '}
                    <strong className="text-slate-900">
                      {unverifiedUser.email}
                    </strong>{' '}
                    puis actualisez ci-dessous.
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
                  onClick={() => {
                    setBusy(true);
                    onVerifiedRefresh().finally(() => setBusy(false));
                  }}
                  className="w-full min-h-[46px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className="w-4 h-4" />
                  J&apos;ai vérifié mon e-mail (actualiser)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleResendVerification}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-sm cursor-pointer disabled:opacity-60"
                >
                  Renvoyer l&apos;e-mail de vérification
                </button>
                <button
                  type="button"
                  onClick={() => signOut(auth)}
                  className="w-full min-h-[44px] rounded-xl text-slate-500 hover:text-slate-800 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Changer de compte
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {/* Mode Switcher */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className={`min-h-[40px] rounded-lg text-sm font-bold cursor-pointer transition-all ${
                    mode === 'login'
                      ? 'bg-white text-[#0a5b9c] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Connexion
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className={`min-h-[40px] rounded-lg text-sm font-bold cursor-pointer transition-all ${
                    mode === 'register'
                      ? 'bg-white text-[#0a5b9c] shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Créer un compte
                </button>
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-3.5">
                {mode === 'register' && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                      Nom et prénom
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="ex. Fabien Pirquin"
                      autoComplete="name"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Adresse e-mail
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="fabien.pirquin@inasep.be"
                    autoComplete="email"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c] focus:ring-2 focus:ring-[#0a5b9c]/15"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Mot de passe
                    </label>
                    {mode === 'login' && (
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
                        mode === 'register'
                          ? 'Minimum 6 caractères'
                          : 'Votre mot de passe'
                      }
                      autoComplete={
                        mode === 'login' ? 'current-password' : 'new-password'
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
                          Ouvrez la console Firebase (projet{' '}
                          <span className="font-mono font-semibold">
                            steel-talent-hv0ns
                          </span>
                          ).
                        </li>
                        <li>
                          Allez dans <strong>Authentication → Sign-in method</strong>.
                        </li>
                        <li>
                          Activez <strong>Adresse e-mail / Mot de passe</strong> et
                          enregistrez.
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
                  {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
                </button>
              </form>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-slate-200 w-full" />
                <span className="bg-white px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  ou
                </span>
                <div className="border-t border-slate-200 w-full" />
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleLogin}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
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
                Continuer avec Google
              </button>

              <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
                <ShieldCheck className="w-4 h-4 text-[#0a5b9c] shrink-0" />
                <span>
                  Synchronisation sécurisée multi-appareils (PC, tablette,
                  smartphone).
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="text-center text-xs text-slate-500 mt-6">
        Journal des travaux INASEP · Signé <strong>{APP_SIGNATURE}</strong>
      </footer>
    </div>
  );
}
