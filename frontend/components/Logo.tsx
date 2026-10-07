/** The Pulse mark: three stacked heartbeat traces, the dashboard plot in miniature. */
export function LogoMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M2 7h7l1.5-3 2 5 1.5-2H22" opacity="0.45" />
      <path d="M2 13h6l2-7 2.5 11 2-6 1.5 2H22" />
      <path d="M2 19h8l1.5-2.5 1.5 3.5 1.5-1H22" opacity="0.45" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em] text-ink">
      <LogoMark />
      Pulse
    </span>
  );
}
