import { useCallback, useEffect, useState } from 'react';
import { type User } from 'firebase/auth';
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Dices,
  ExternalLink,
  KeyRound,
  MonitorSmartphone,
  Pencil,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { FIRESTORE_QUOTA_URL, isAdminEmail } from '../firebase';
import type { AccessUserRecord, PreauthorizedEmail } from '../types';
import {
  deleteAccessUserAdmin,
  deletePreauthorizedAndDevicesAdmin,
  fetchAdminAccessData,
  savePreauthorizedEmailAdmin,
  updateAccessUserStatusAdmin,
} from '../utils/firestoreService';
import { ConfirmModal } from './ConfirmModal';

interface AccessAdminViewProps {
  user: User;
  onNotify: (msg: string, tone?: 'default' | 'success' | 'error') => void;
}

function generateSixDigitCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  const num = 100000 + (bytes[0] % 900000);
  return String(num);
}

export function AccessAdminView({ user, onNotify }: AccessAdminViewProps) {
  const [preauthorized, setPreauthorized] = useState<PreauthorizedEmail[]>([]);
  const [accessUsers, setAccessUsers] = useState<AccessUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add colleague form
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState(() => generateSixDigitCode());
  const [noteInput, setNoteInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline code/note edit state
  const [editingPreauthId, setEditingPreauthId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editNote, setEditNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Confirm delete modal
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchAdminAccessData();
      setPreauthorized(data.preauthorized);
      setAccessUsers(data.accessUsers);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger la liste des accès.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    const cleanCode = codeInput.trim();
    const cleanNote = noteInput.trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      onNotify('Saisissez une adresse e-mail valide.', 'error');
      return;
    }
    if (cleanCode.length < 3 || cleanCode.length > 32) {
      onNotify(
        'Le code personnel doit contenir entre 3 et 32 caractères.',
        'error'
      );
      return;
    }

    setSaving(true);
    try {
      const saved = await savePreauthorizedEmailAdmin({
        email: cleanEmail,
        accessCode: cleanCode,
        note: cleanNote,
        adminEmail: user.email || '',
        existingAccessUsers: accessUsers,
      });

      setPreauthorized((prev) => {
        const filtered = prev.filter((p) => p.id !== saved.id);
        return [...filtered, saved].sort((a, b) =>
          a.email.localeCompare(b.email)
        );
      });
      setAccessUsers((prev) =>
        prev.map((u) =>
          u.email.trim().toLowerCase() === cleanEmail &&
          (u.status === 'pending' || u.status === 'revoked')
            ? {
                ...u,
                status: 'approved',
                activationCode: cleanCode,
                note: cleanNote || u.note,
              }
            : u
        )
      );

      setEmailInput('');
      setCodeInput(generateSixDigitCode());
      setNoteInput('');
      onNotify(`Accès configuré pour ${saved.email}.`, 'success');
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer l'accès.",
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInlineEdit = async (target: PreauthorizedEmail) => {
    const cleanCode = editCode.trim();
    const cleanNote = editNote.trim();
    if (cleanCode.length < 3 || cleanCode.length > 32) {
      onNotify(
        'Le code personnel doit contenir entre 3 et 32 caractères.',
        'error'
      );
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await savePreauthorizedEmailAdmin({
        email: target.email,
        accessCode: cleanCode,
        note: cleanNote,
        adminEmail: user.email || '',
        existingAccessUsers: accessUsers,
      });
      setPreauthorized((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      setAccessUsers((prev) =>
        prev.map((u) =>
          u.email.trim().toLowerCase() === target.email.toLowerCase() &&
          (u.status === 'pending' || u.status === 'revoked')
            ? {
                ...u,
                status: 'approved',
                activationCode: cleanCode,
                note: cleanNote || u.note,
              }
            : u
        )
      );
      setEditingPreauthId(null);
      onNotify(`Code et note mis à jour pour ${target.email}.`, 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Erreur lors de la modification.',
        'error'
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCopyCredentials = async (item: PreauthorizedEmail) => {
    const appUrl = `${window.location.origin}${window.location.pathname}`;
    const text = `Accès Journal des travaux INASEP\nLien : ${appUrl}\nE-mail : ${item.email}\nCode personnel : ${item.accessCode}`;
    try {
      await navigator.clipboard.writeText(text);
      onNotify('E-mail, code et lien copiés.', 'success');
    } catch {
      onNotify('Copie automatique impossible.', 'error');
    }
  };

  const handleDeletePreauth = (item: PreauthorizedEmail) => {
    setConfirmState({
      title: `Supprimer l'accès de ${item.email} ?`,
      message:
        "Cette action supprime l'e-mail préautorisé ainsi que toutes ses fiches appareils pour couper l'accès immédiatement.",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const removedUids = await deletePreauthorizedAndDevicesAdmin(
            item.id,
            item.email,
            accessUsers
          );
          setPreauthorized((prev) => prev.filter((p) => p.id !== item.id));
          setAccessUsers((prev) =>
            prev.filter((u) => !removedUids.includes(u.uid))
          );
          onNotify(`Accès et appareils supprimés pour ${item.email}.`);
        } catch (err) {
          onNotify(
            err instanceof Error ? err.message : 'Erreur lors de la suppression.',
            'error'
          );
        }
      },
    });
  };

  const nonAdminUsers = accessUsers.filter(
    (u) => u.uid !== user.uid && !isAdminEmail(u.email)
  );
  const preauthEmailSet = new Set(
    preauthorized.map((p) => p.email.trim().toLowerCase())
  );
  const pendingWithoutCode = nonAdminUsers.filter(
    (u) => u.status === 'pending'
  );
  const otherDevices = nonAdminUsers.filter(
    (u) =>
      u.status !== 'pending' &&
      (!preauthEmailSet.has(u.email.trim().toLowerCase()) ||
        u.status === 'revoked')
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-[#0a5b9c]" />
            Accès complets collègues
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Réservé aux collègues disposant des mêmes droits complets que vous
            (créer et gérer leurs propres chantiers et journaux). Pour donner un
            accès en lecture seule &amp; signature sur 1 seul dossier
            (entrepreneur/client), encodez 0 à 3 e-mails directement dans{' '}
            <strong>Modifier le chantier</strong>.
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void loadData()}
          className="min-h-[42px] px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-2 cursor-pointer shrink-0 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {/* Quota / Load error */}
      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-red-900">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
          {loadError.toLowerCase().includes('quota') && (
            <a
              href={FIRESTORE_QUOTA_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-red-800 hover:underline flex items-center gap-1 shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Quota Spark
            </a>
          )}
        </div>
      )}

      {/* Encode / Preauthorize Colleague Form */}
      <form
        onSubmit={handleSaveNew}
        className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
      >
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-[#0a5b9c]" />
            Autoriser un collègue (accès complet) avec code personnel
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ce collègue pourra créer ses propres chantiers et rédiger ses
            journaux. S&apos;il avait déjà demandé l&apos;accès sans code,
            l&apos;enregistrement active directement sa fiche.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Adresse e-mail (Google ou pro)
            </label>
            <input
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="collegue@inasep.be"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Code personnel (3 à 32 car.)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                required
                minLength={3}
                maxLength={32}
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="ex. 482910"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white font-mono text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
              />
              <button
                type="button"
                onClick={() => setCodeInput(generateSixDigitCode())}
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer shrink-0"
                title="Générer un code à 6 chiffres"
              >
                <Dices className="w-4 h-4 text-[#0a5b9c]" />
                Générer
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Note / nom / équipe (optionnel)
            </label>
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="ex. Marc · Égouttage"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#0a5b9c]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-5 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <UserPlus className="w-4 h-4" />
            {saving ? 'Enregistrement…' : 'Enregistrer cet accès'}
          </button>
        </div>
      </form>

      {/* Section: Accès configurés */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <KeyRound className="w-4 h-4 text-[#0a5b9c]" />
          Accès configurés ({preauthorized.length})
        </h2>

        {loading && preauthorized.length === 0 ? (
          <div className="p-4 rounded-xl border border-slate-200 text-xs text-slate-500">
            Chargement depuis Firestore…
          </div>
        ) : preauthorized.length === 0 ? (
          <div className="p-4 rounded-xl border border-slate-200 text-xs text-slate-500">
            Aucun collègue préautorisé pour le moment. Utilisez le formulaire
            ci-dessus pour encoder un e-mail et son code personnel.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {preauthorized.map((item) => {
              const matchingDevices = nonAdminUsers.filter(
                (u) =>
                  u.email.trim().toLowerCase() ===
                    item.email.trim().toLowerCase() && u.status === 'approved'
              );
              const isEditing = editingPreauthId === item.id;

              return (
                <div key={item.id} className="p-4 space-y-3 bg-white">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 break-all">
                          {item.email}
                        </span>
                        {matchingDevices.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <MonitorSmartphone className="w-3 h-3" />
                            Connecté (
                            {matchingDevices
                              .map((d) => d.deviceHint || 'Appareil')
                              .join(', ')}
                            )
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                            En attente de 1re connexion
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          Code :{' '}
                          <strong className="font-mono text-[#0a5b9c]">
                            {item.accessCode}
                          </strong>
                        </span>
                        {item.note && <span>· {item.note}</span>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleCopyCredentials(item)}
                        className="min-h-[38px] px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copier
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingPreauthId(null);
                          } else {
                            setEditingPreauthId(item.id);
                            setEditCode(item.accessCode);
                            setEditNote(item.note);
                          }
                        }}
                        className="min-h-[38px] px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Code
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeletePreauth(item)}
                        className="min-h-[38px] px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Supprimer
                      </button>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Nouveau code (3–32 car.)
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editCode}
                            onChange={(e) => setEditCode(e.target.value)}
                            className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-900"
                          />
                          <button
                            type="button"
                            onClick={() => setEditCode(generateSixDigitCode())}
                            className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer"
                            title="Générer 6 chiffres"
                          >
                            <Dices className="w-3.5 h-3.5 text-[#0a5b9c]" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Note
                        </label>
                        <input
                          type="text"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingPreauthId(null)}
                          className="min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 flex items-center gap-1 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          Annuler
                        </button>
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => void handleSaveInlineEdit(item)}
                          className="min-h-[38px] px-3 rounded-lg bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-60"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Enregistrer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section: Demandes en attente sans code */}
      {pendingWithoutCode.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-700" />
            Demandes en attente sans code ({pendingWithoutCode.length})
          </h2>

          <div className="rounded-xl border border-amber-200 bg-white divide-y divide-amber-100 overflow-hidden">
            {pendingWithoutCode.map((u) => (
              <div
                key={u.uid}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {u.email || u.displayName}
                  </div>
                  <div className="text-xs text-slate-500">
                    {u.displayName} · {u.deviceHint || 'Appareil inconnu'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await updateAccessUserStatusAdmin(u.uid, 'approved');
                        setAccessUsers((prev) =>
                          prev.map((item) =>
                            item.uid === u.uid
                              ? { ...item, status: 'approved' }
                              : item
                          )
                        );
                        onNotify(`Accès autorisé pour ${u.email}.`, 'success');
                      } catch (err) {
                        onNotify(
                          err instanceof Error ? err.message : 'Erreur.',
                          'error'
                        );
                      }
                    }}
                    className="min-h-[38px] px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    Autoriser
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await updateAccessUserStatusAdmin(u.uid, 'revoked');
                        setAccessUsers((prev) =>
                          prev.map((item) =>
                            item.uid === u.uid
                              ? { ...item, status: 'revoked' }
                              : item
                          )
                        );
                        onNotify(`Demande refusée pour ${u.email}.`);
                      } catch (err) {
                        onNotify(
                          err instanceof Error ? err.message : 'Erreur.',
                          'error'
                        );
                      }
                    }}
                    className="min-h-[38px] px-3.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                    Refuser
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section: Autres appareils enregistrés */}
      {otherDevices.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <MonitorSmartphone className="w-4 h-4 text-slate-600" />
            Autres appareils enregistrés ({otherDevices.length})
          </h2>

          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {otherDevices.map((u) => (
              <div
                key={u.uid}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 truncate">
                      {u.email || u.displayName}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                        u.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {u.status === 'approved' ? 'Autorisé' : 'Révoqué'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {u.displayName} · {u.deviceHint || 'Appareil'}
                    {u.note ? ` · ${u.note}` : ''}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {u.status === 'approved' ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await updateAccessUserStatusAdmin(u.uid, 'revoked');
                          setAccessUsers((prev) =>
                            prev.map((item) =>
                              item.uid === u.uid
                                ? { ...item, status: 'revoked' }
                                : item
                            )
                          );
                          onNotify(`Accès révoqué pour ${u.email}.`);
                        } catch (err) {
                          onNotify(
                            err instanceof Error ? err.message : 'Erreur.',
                            'error'
                          );
                        }
                      }}
                      className="min-h-[38px] px-3 rounded-lg border border-amber-200 text-amber-800 hover:bg-amber-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <ShieldOff className="w-3.5 h-3.5" />
                      Révoquer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await updateAccessUserStatusAdmin(u.uid, 'approved');
                          setAccessUsers((prev) =>
                            prev.map((item) =>
                              item.uid === u.uid
                                ? { ...item, status: 'approved' }
                                : item
                            )
                          );
                          onNotify(`Accès réactivé pour ${u.email}.`, 'success');
                        } catch (err) {
                          onNotify(
                            err instanceof Error ? err.message : 'Erreur.',
                            'error'
                          );
                        }
                      }}
                      className="min-h-[38px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Réactiver
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setConfirmState({
                        title: `Supprimer la fiche appareil de ${u.email} ?`,
                        message:
                          "Cet appareil n'aura plus accès tant qu'il ne sera pas réactivé.",
                        onConfirm: async () => {
                          setConfirmState(null);
                          try {
                            await deleteAccessUserAdmin(u.uid);
                            setAccessUsers((prev) =>
                              prev.filter((item) => item.uid !== u.uid)
                            );
                            onNotify('Fiche appareil supprimée.');
                          } catch (err) {
                            onNotify(
                              err instanceof Error ? err.message : 'Erreur.',
                              'error'
                            );
                          }
                        },
                      });
                    }}
                    className="min-h-[38px] px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel="Supprimer"
        danger
        onConfirm={() => {
          void confirmState?.onConfirm();
        }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
