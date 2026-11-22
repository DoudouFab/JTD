interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className = 'w-9 h-9' }: AppLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      role="img"
      aria-label="Logo Mes JDT"
      className={className}
    >
      <defs>
        <linearGradient id="mes-jdt-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0d6ebd" />
          <stop offset="100%" stopColor="#053d73" />
        </linearGradient>
        <linearGradient id="mes-jdt-check" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect
        x="0"
        y="0"
        width="512"
        height="512"
        rx="112"
        fill="url(#mes-jdt-bg)"
      />
      <rect x="122" y="102" width="268" height="346" rx="28" fill="#ffffff" />
      <rect x="182" y="92" width="148" height="56" rx="16" fill="#064e8c" />
      <rect x="194" y="84" width="124" height="50" rx="14" fill="#ffffff" />
      <circle cx="256" cy="84" r="26" fill="#ffffff" />
      <circle cx="256" cy="84" r="10" fill="#075498" />
      <path
        d="M196 244 L238 286 L326 196"
        fill="none"
        stroke="url(#mes-jdt-check)"
        strokeWidth="34"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <text
        x="256"
        y="412"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        fontSize="92"
        fontWeight="900"
        letterSpacing="4"
        fill="#064e8c"
      >
        JDT
      </text>
    </svg>
  );
}
