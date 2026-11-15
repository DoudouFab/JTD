import { FileJson, X } from 'lucide-react';
import type { DB } from '../types';

interface JsonImportModalProps {
  pendingData: DB | null;
  onReplace: () => void;
  onMerge: () => void;
  onCancel: () => void;
}

export function JsonImportModal({
  pendingData,
  onReplace,
  onMerge,
  onCancel,
}: JsonImportModalProps) {
  if (!pendingData) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4"
      onClick={onCancel}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center">
              <FileJson className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Importer une sauvegarde (.json)
              </h3>
              <p className="mt-1 text-sm text-slate-600 tabular-nums">
                Le fichier contient{' '}
                <strong className="text-slate-900">
                  {pendingData.chantiers.length}
                </strong>{' '}
                chantier(s) et{' '}
                <strong className="text-slate-900">
                  {pendingData.journaux.length}
                </strong>{' '}
                journal(aux).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500 leading-relaxed">
          Choisissez <span className="font-semibold text-slate-700">Fusionner</span>{' '}
          pour conserver vos données actuelles et ajouter uniquement les éléments
          manquants, ou{' '}
          <span className="font-semibold text-red-700">Remplacer tout</span> pour
          restaurer exactement cette sauvegarde.
        </p>

        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onMerge}
            className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white font-semibold text-sm cursor-pointer"
          >
            Fusionner
          </button>
          <button
            type="button"
            onClick={onReplace}
            className="flex-1 min-h-[44px] px-4 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-sm cursor-pointer"
          >
            Remplacer tout
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 cursor-pointer"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
