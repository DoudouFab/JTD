import { FileDown } from 'lucide-react';
import type { PdfProgress } from '../utils/pdfExport';

interface PdfProgressModalProps {
  progress: PdfProgress | null;
}

export function PdfProgressModal({ progress }: PdfProgressModalProps) {
  if (!progress) return null;
  const pct =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-xs p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0a5b9c]/10 text-[#0a5b9c] flex items-center justify-center shrink-0">
            <FileDown className="w-5 h-5 animate-bounce" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">
              Génération du PDF A4
            </h3>
            <p className="text-xs text-slate-600 truncate mt-0.5">
              {progress.label}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs font-semibold text-slate-600 tabular-nums mb-1.5">
            <span>
              Page {progress.current} / {progress.total}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0a5b9c] transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
