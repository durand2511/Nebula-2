interface LogoProps {
  className?: string;
  showWordmark?: boolean;
}

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="hsl(var(--primary))" />
      <path
        d="M16 5.5 25 10.75v10.5L16 26.5 7 21.25v-10.5L16 5.5Z"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
        opacity="0.35"
      />
      <path
        d="M16 16 25 10.75M16 16v10.5M16 16 7 10.75"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.1" fill="hsl(var(--primary-foreground))" />
    </svg>
  );
}

export function Logo({ className = "", showWordmark = true }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-7 w-7" />
      {showWordmark && (
        <span className="font-display text-[1.15rem] font-bold tracking-tight text-foreground">
          Buildly
        </span>
      )}
    </span>
  );
}
