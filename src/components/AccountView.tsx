import {
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import { FolderOpen, KeyRound, Save, Smartphone, Trash2 } from 'lucide-react';
import { auth } from '../firebase';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type { UserProfile } from '../types';
import { PWAInstallButton } from './PWAInstallButton';
import {
  fetchUserPreferencesOnce,
  updateUserPreferences,
} from '../utils/firestoreService';
import {
  DEFAULT_DAY_FOLDER_KEY,
  DEFAULT_WEEK_FOLDER_KEY,
  deleteDirHandle,
  getDirHandle,
  isFsAccessSupported,
  pickAndStoreFolder,
} from '../utils/storage';

interface AccountViewProps {
  user: User;
  profile: UserProfile;
  isAdmin: boolean;
  onProfileUpdated: (next: UserProfile) => void;
  onNotify: (msg: string, tone?: 'default' | 'success' | 'error') => void;
}

export function AccountView({
  user,
  profile,
  isAdmin,
  onProfileUpdated,
  onNotify,
}: AccountViewProps) {
  // Preferences form
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [defaultPrepose, setDefaultPrepose] = useState(profile.defaultPrepose);
  const [defaultHoraireDebut, setDefaultHoraireDebut] = useState(
    profile.defaultHoraireDebut || '07:30'
  );
  const [defaultHoraireFin, setDefaultHoraireFin] = useState(
    profile.defaultHoraireFin || '16:30'
  );
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Password change form
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  // Default PDF folders
  const fsSupported = isFsAccessSupported();
  const { isInstalled } = usePWAInstall();
  const [defaultDayFolderName, setDefaultDayFolderName] = useState<string | null>(
    null
  );
  const [defaultWeekFolderName, setDefaultWeekFolderName] = useState<
    string | null
  >(null);

  const hasPasswordProvider = user.providerData.some(
    (p) => p.providerId === 'password'
  );

  // Fetch user preferences once when opening the Account tab (0 reads at app startup)
  useEffect(() => {
    let active = true;
    void fetchUserPreferencesOnce(user).then((loaded) => {
      if (!active) return;
      onProfileUpdated(loaded);
      setDisplayName(loaded.displayName);
      setDefaultPrepose(loaded.defaultPrepose);
      setDefaultHoraireDebut(loaded.defaultHoraireDebut || '07:30');
      setDefaultHoraireFin(loaded.defaultHoraireFin || '16:30');
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  useEffect(() => {
    if (!fsSupported) return;
    getDirHandle(DEFAULT_DAY_FOLDER_KEY).then((h) =>
      setDefaultDayFolderName(h ? h.name : null)
    );
    getDirHandle(DEFAULT_WEEK_FOLDER_KEY).then((h) =>
      setDefaultWeekFolderName(h ? h.name : null)
    );
  }, [fsSupported]);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrefs(true);
    try {
      await updateUserPreferences(user.uid, {
        displayName: displayName.trim() || profile.displayName,
        defaultPrepose: defaultPrepose.trim(),
        defaultHoraireDebut: defaultHoraireDebut || '07:30',
        defaultHoraireFin: defaultHoraireFin || '16:30',
      });
      onProfileUpdated({
        ...profile,
        displayName: displayName.trim() || profile.displayName,
        defaultPrepose: defaultPrepose.trim(),
        defaultHoraireDebut: defaultHoraireDebut || '07:30',
        defaultHoraireFin: defaultHoraireFin || '16:30',
      });
      onNotify('Préférences du compte enregistrées.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la sauvegarde des préférences.',
        'error'
      );
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 6) {
      onNotify(
        'Le nouveau mot de passe doit contenir au moins 6 caractères.',
        'error'
      );
      return;
    }
    if (newPwd !== confirmPwd) {
      onNotify('Les deux mots de passe ne correspondent pas.', 'error');
      return;
    }

    setSavingPwd(true);
    try {
      if (hasPasswordProvider) {
        if (!currentPwd || !user.email) {
          onNotify('Saisissez votre mot de passe actuel.', 'error');
          setSavingPwd(false);
          return;
        }
        const cred = EmailAuthProvider.credential(user.email, currentPwd);
        await reauthenticateWithCredential(user, cred);
        await updatePassword(user, newPwd);
      } else if (user.email) {
        const cred = EmailAuthProvider.credential(user.email, newPwd);
        await linkWithCredential(user, cred);
      }
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      onNotify('Mot de passe mis à jour avec succès.', 'success');
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        onNotify('Mot de passe actuel incorrect.', 'error');
      } else if (code === 'auth/requires-recent-login') {
        onNotify(
          'Reconnectez-vous brièvement avant de modifier votre mot de passe.',
          'error'
        );
      } else {
        onNotify('Impossible de modifier le mot de passe.', 'error');
      }
    } finally {
      setSavingPwd(false);
    }
  };

  const handlePickDefaultFolder = async (type: 'day' | 'week') => {
    const key =
      type === 'day' ? DEFAULT_DAY_FOLDER_KEY : DEFAULT_WEEK_FOLDER_KEY;
    try {
      const handle = await pickAndStoreFolder(key);
      if (handle) {
        if (type === 'day') setDefaultDayFolderName(handle.name);
        else setDefaultWeekFolderName(handle.name);
        onNotify(`Dossier par défaut « ${handle.name} » enregistré.`, 'success');
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        onNotify('Impossible de sélectionner le dossier.', 'error');
      }
    }
  };

  const handleUnlinkDefaultFolder = async (type: 'day' | 'week') => {
    const key =
      type === 'day' ? DEFAULT_DAY_FOLDER_KEY : DEFAULT_WEEK_FOLDER_KEY;
    await deleteDirHandle(key);
    if (type === 'day') setDefaultDayFolderName(null);
    else setDefaultWeekFolderName(null);
    onNotify('Dossier par défaut dissocié.');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Mon compte
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {user.email} ·{' '}
            {isAdmin
              ? 'Administrateur (onglet Accès disponible dans la barre supérieure)'
              : 'Compte autorisé'}
          </p>
        </div>
      </div>

      {/* 1. Profil & Préposé par défaut */}
      <form
        onSubmit={handleSavePreferences}
        className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
      >
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Profil &amp; paramètres par défaut des chantiers
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ces valeurs pré-remplissent automatiquement chaque nouveau chantier
            que vous créez.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Nom affiché
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ex. Fabien Pirquin"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Nom du préposé à la surveillance par défaut
            </label>
            <input
              type="text"
              value={defaultPrepose}
              onChange={(e) => setDefaultPrepose(e.target.value)}
              placeholder="ex. F. Pirquin"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Horaire début par défaut
            </label>
            <input
              type="time"
              value={defaultHoraireDebut}
              onChange={(e) => setDefaultHoraireDebut(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Horaire fin par défaut
            </label>
            <input
              type="time"
              value={defaultHoraireFin}
              onChange={(e) => setDefaultHoraireFin(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-[#0a5b9c]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingPrefs}
            className="min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {savingPrefs ? 'Enregistrement…' : 'Enregistrer mes préférences'}
          </button>
        </div>
      </form>

      {/* 2. Espaces d'enregistrement par défaut */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Espaces d&apos;enregistrement par défaut (OneDrive / PC)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {fsSupported
              ? 'Utilisés automatiquement lors du téléchargement PDF si aucun dossier spécifique n’est défini sur le chantier.'
              : 'Sur ce navigateur (ex. Safari iOS), les fichiers PDF sont enregistrés dans Téléchargements / Fichiers.'}
          </p>
        </div>

        {fsSupported && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold text-slate-500">
                Dossier PDF Journées par défaut
              </div>
              <div className="text-sm font-bold text-slate-900 truncate mt-1 mb-3">
                {defaultDayFolderName || 'Non défini (téléchargement)'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePickDefaultFolder('day')}
                  className="flex-1 min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" />
                  Choisir un dossier
                </button>
                {defaultDayFolderName && (
                  <button
                    type="button"
                    onClick={() => handleUnlinkDefaultFolder('day')}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-red-600 cursor-pointer"
                    title="Dissocier"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold text-slate-500">
                Dossier PDF Semaines par défaut
              </div>
              <div className="text-sm font-bold text-slate-900 truncate mt-1 mb-3">
                {defaultWeekFolderName || 'Non défini (téléchargement)'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePickDefaultFolder('week')}
                  className="flex-1 min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" />
                  Choisir un dossier
                </button>
                {defaultWeekFolderName && (
                  <button
                    type="button"
                    onClick={() => handleUnlinkDefaultFolder('week')}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-red-600 cursor-pointer"
                    title="Dissocier"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 3. Mot de passe & Sécurité */}
      <form
        onSubmit={handleChangePassword}
        className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#0a5b9c]" />
              Mot de passe &amp; sécurité
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {hasPasswordProvider
                ? 'Modifiez votre mot de passe de connexion à tout moment.'
                : 'Définissez un mot de passe pour vous connecter aussi sans Google.'}
            </p>
          </div>
          {user.email && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await sendPasswordResetEmail(auth, user.email!);
                  onNotify(
                    `E-mail de réinitialisation envoyé à ${user.email}.`,
                    'success'
                  );
                } catch {
                  onNotify("Impossible d'envoyer l'e-mail.", 'error');
                }
              }}
              className="text-xs font-semibold text-[#0a5b9c] hover:underline cursor-pointer self-start sm:self-center"
            >
              Recevoir un lien par e-mail
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {hasPasswordProvider && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Mot de passe actuel
              </label>
              <input
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Nouveau mot de passe
            </label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="Min. 6 caractères"
              autoComplete="new-password"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Confirmer
            </label>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="Répéter le mot de passe"
              autoComplete="new-password"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingPwd}
            className="min-h-[44px] px-5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <KeyRound className="w-4 h-4" />
            {savingPwd ? 'Mise à jour…' : 'Mettre à jour le mot de passe'}
          </button>
        </div>
      </form>

      {/* 4. Application installée & synchronisation multi-appareils */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Application mobile &amp; raccourci « Mes JDT »
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              {isInstalled
                ? 'Mes JDT est installée sur cet appareil. Vos chantiers et journaux restent synchronisés sur toutes vos plateformes (PC, smartphone, tablette).'
                : 'Installez Mes JDT sur votre téléphone ou ordinateur pour obtenir l’icône dédiée « Mes JDT » et retrouver vos derniers JDT à jour sur n’importe quel appareil.'}
            </p>
          </div>
        </div>
        {!isInstalled && (
          <div className="pt-1">
            <PWAInstallButton variant="card" />
          </div>
        )}
      </section>
    </div>
  );
}
