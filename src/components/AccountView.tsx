import {
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import {
  Clock,
  FolderOpen,
  KeyRound,
  Save,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { auth } from '../firebase';
import type { UserProfile } from '../types';
import {
  createUserAccountAdmin,
  deleteUserProfileAdmin,
  fetchAllUsersAdmin,
  updateUserAdmin,
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
  const [defaultDayFolderName, setDefaultDayFolderName] = useState<string | null>(
    null
  );
  const [defaultWeekFolderName, setDefaultWeekFolderName] = useState<
    string | null
  >(null);

  // Sole Admin: Account authorization & management
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPwd, setNewUserPwd] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  const hasPasswordProvider = user.providerData.some(
    (p) => p.providerId === 'password'
  );

  useEffect(() => {
    setDisplayName(profile.displayName);
    setDefaultPrepose(profile.defaultPrepose);
    setDefaultHoraireDebut(profile.defaultHoraireDebut || '07:30');
    setDefaultHoraireFin(profile.defaultHoraireFin || '16:30');
  }, [profile]);

  useEffect(() => {
    if (!fsSupported) return;
    getDirHandle(DEFAULT_DAY_FOLDER_KEY).then((h) =>
      setDefaultDayFolderName(h ? h.name : null)
    );
    getDirHandle(DEFAULT_WEEK_FOLDER_KEY).then((h) =>
      setDefaultWeekFolderName(h ? h.name : null)
    );
  }, [fsSupported]);

  const loadAdminUsers = async () => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    try {
      const list = await fetchAllUsersAdmin();
      setUsers(list);
    } catch {
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    void loadAdminUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

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
    } catch {
      onNotify('Erreur lors de la sauvegarde des préférences.', 'error');
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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim() || !newUserPwd) {
      onNotify('Indiquez une adresse e-mail et un mot de passe initial.', 'error');
      return;
    }
    if (newUserPwd.length < 6) {
      onNotify(
        'Le mot de passe initial doit contenir au moins 6 caractères.',
        'error'
      );
      return;
    }

    setCreatingUser(true);
    try {
      const created = await createUserAccountAdmin({
        displayName: newUserName.trim() || newUserEmail.split('@')[0],
        email: newUserEmail.trim(),
        password: newUserPwd,
      });
      setUsers((prev) =>
        [...prev, created].sort((a, b) =>
          a.displayName.localeCompare(b.displayName)
        )
      );
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPwd('');
      onNotify(
        `Compte créé et autorisé pour ${created.email} (e-mail de vérification envoyé).`,
        'success'
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/email-already-in-use') {
        onNotify('Cette adresse e-mail possède déjà un compte.', 'error');
      } else if (code === 'auth/operation-not-allowed') {
        onNotify(
          'Activez « Adresse e-mail / Mot de passe » dans Firebase Console > Authentication.',
          'error'
        );
      } else {
        onNotify('Impossible de créer ce compte utilisateur.', 'error');
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleActive = async (target: UserProfile) => {
    const nextActive = !target.active;
    try {
      await updateUserAdmin(target.uid, { active: nextActive });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === target.uid ? { ...u, active: nextActive } : u
        )
      );
      onNotify(
        nextActive
          ? `Accès autorisé pour ${target.displayName}.`
          : `Accès suspendu pour ${target.displayName}.`,
        nextActive ? 'success' : 'default'
      );
    } catch {
      onNotify('Impossible de modifier le statut.', 'error');
    }
  };

  const handleRemoveProfile = async (target: UserProfile) => {
    try {
      await deleteUserProfileAdmin(target.uid);
      setUsers((prev) => prev.filter((u) => u.uid !== target.uid));
      onNotify('Profil retiré de la liste.');
    } catch {
      onNotify('Impossible de supprimer ce profil.', 'error');
    }
  };

  const pendingUsers = users.filter((u) => !u.active && u.uid !== user.uid);
  const authorizedUsers = users.filter((u) => u.active || u.uid === user.uid);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Mon compte
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {user.email} · {isAdmin ? 'Administrateur unique' : 'Utilisateur autorisé'}
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

      {/* 4. Sous-section Admin unique : Autorisation & gestion des comptes */}
      {isAdmin && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-6">
          <div className="flex items-center justify-between gap-2.5 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Gestion &amp; autorisation des comptes (Administrateur unique)
                </h2>
                <p className="text-xs text-slate-500">
                  Vous êtes seul administrateur : autorisez ou suspendez
                  l&apos;accès des utilisateurs. Chaque utilisateur gère ses
                  propres chantiers en toute confidentialité.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadAdminUsers()}
              className="min-h-[38px] px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shrink-0"
            >
              Actualiser
            </button>
          </div>

          {/* Pending Authorization Requests */}
          {pendingUsers.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-700" />
                Comptes en attente d&apos;autorisation ({pendingUsers.length})
              </div>
              <div className="rounded-xl border border-amber-200 bg-white divide-y divide-amber-100 overflow-hidden">
                {pendingUsers.map((u) => (
                  <div
                    key={u.uid}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">
                        {u.displayName}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {u.email || u.uid} · En attente d&apos;activation
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(u)}
                        className="min-h-[38px] px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Autoriser l&apos;accès
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveProfile(u)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 cursor-pointer"
                        title="Refuser / supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Create collaborator form */}
          <form
            onSubmit={handleCreateUser}
            className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
          >
            <div className="text-xs font-bold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-[#0a5b9c]" />
              Créer et autoriser directement un utilisateur
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Nom complet"
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
              />
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="email@exemple.be"
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
              />
              <input
                type="password"
                value={newUserPwd}
                onChange={(e) => setNewUserPwd(e.target.value)}
                placeholder="Mot de passe (min. 6)"
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creatingUser}
                className="min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <UserPlus className="w-4 h-4" />
                {creatingUser ? 'Création…' : 'Créer et autoriser'}
              </button>
            </div>
          </form>

          {/* Authorized users list */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              Comptes autorisés ({authorizedUsers.length})
            </h3>

            {loadingUsers ? (
              <div className="p-4 rounded-xl border border-slate-200 text-xs text-slate-500">
                Chargement des comptes…
              </div>
            ) : authorizedUsers.length === 0 ? (
              <div className="p-4 rounded-xl border border-slate-200 text-xs text-slate-500">
                Aucun autre compte enregistré.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {authorizedUsers.map((u) => {
                  const isSelf = u.uid === user.uid;
                  return (
                    <div
                      key={u.uid}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {u.displayName}
                          {isSelf ? ' (moi — Admin)' : ''}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {u.email || u.uid} ·{' '}
                          {u.role === 'admin'
                            ? 'Administrateur unique'
                            : 'Utilisateur autorisé'}
                        </div>
                      </div>

                      {!isSelf && (
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            className="min-h-[38px] px-3 rounded-lg border border-amber-200 text-amber-800 hover:bg-amber-50 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            Suspendre
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveProfile(u)}
                            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 cursor-pointer"
                            title="Retirer le profil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
