import { CheckCircle2, AlertCircle } from 'lucide-react';

export interface ToastState {
  message: string;
  tone?: 'default' | 'success' | 'error';
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;

  const isError = toast.tone === 'error';
  const isSuccess = toast.tone === 'success';

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] pointer-events-none">
      <div
        className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${
          isError
            ? 'bg-red-700'
            : isSuccess
            ? 'bg-emerald-700'
            : 'bg-slate-900'
        }`}
      >
        {isError ? (
          <AlertCircle className="w-4 h-4 shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#d9d61f]" />
        )}
        <span className="truncate sm:whitespace-normal">{toast.message}</span>
      </div>
    </div>
  );
}
