import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { AppLogo } from './AppLogo';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const buttonClass =
    variant === 'header'
      ? 'min-h-[38px] px-2.5 sm:px-3 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shrink-0'
      : 'min-h-[42px] px-4 rounded-xl border border-[#0a5b9c]/30 bg-[#0a5b9c]/[0.06] hover:bg-[#0a5b9c]/10 text-[#0a5b9c] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors w-full';

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  if (!isInstallable && !isIOS && variant === 'header') {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={buttonClass}
        title="Installer Mes JDT sur l'écran d'accueil"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className={variant === 'header' ? 'hidden sm:inline' : ''}>
          Installer l&apos;app
        </span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-0 sm:p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl p-5 sm:p-6 space-y-4 text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <AppLogo className="w-11 h-11 rounded-xl shrink-0 shadow-xs" />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Installer Mes JDT
                  </h3>
                  <p className="text-xs text-slate-500">
                    Raccourci « Mes JDT » sur votre écran d&apos;accueil
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-xs text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-200">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#0a5b9c]">1.</span>
                  <span>
                    Dans Safari, appuyez sur le bouton{' '}
                    <strong className="inline-flex items-center gap-1">
                      <Share className="w-3.5 h-3.5 text-[#0a5b9c]" />
                      Partager
                    </strong>{' '}
                    dans la barre du navigateur.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#0a5b9c]">2.</span>
                  <span>
                    Faites défiler et choisissez{' '}
                    <strong>Sur l&apos;écran d&apos;accueil</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#0a5b9c]">3.</span>
                  <span>
                    Confirmez le nom <strong>Mes JDT</strong> puis appuyez sur{' '}
                    <strong>Ajouter</strong>.
                  </span>
                </li>
              </ol>
            ) : (
              <div className="space-y-2 text-xs text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-200">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Smartphone className="w-4 h-4 text-[#0a5b9c]" />
                  Sur Android / Chrome / Edge :
                </div>
                <p className="leading-relaxed">
                  Ouvrez le menu <strong>⋮</strong> du navigateur et sélectionnez{' '}
                  <strong>Ajouter à l&apos;écran d&apos;accueil</strong> ou{' '}
                  <strong>Installer l&apos;application Mes JDT</strong>.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#0a5b9c] hover:bg-[#063f6e] text-white text-sm font-semibold cursor-pointer"
            >
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
}
