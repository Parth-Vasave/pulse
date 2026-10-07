import type { DisplayStatus } from "@/lib/types";

// Status is never color-only: each state has its own mark shape and a text label.
const CONFIG: Record<DisplayStatus, { label: string; text: string; mark: React.ReactNode }> = {
  up: { label: "UP", text: "text-ink-2", mark: <circle cx="5" cy="5" r="3.5" fill="var(--up)" /> },
  down: { label: "DOWN", text: "text-down", mark: <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="var(--down)" /> },
  paused: { label: "PAUSED", text: "text-muted", mark: <path d="M3 1.5v7M7 1.5v7" stroke="var(--paused)" strokeWidth="1.6" strokeLinecap="round" /> },
  unknown: { label: "PENDING", text: "text-muted", mark: <circle cx="5" cy="5" r="3.2" fill="none" stroke="var(--paused)" strokeWidth="1.3" strokeDasharray="2 1.6" /> },
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const c = CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[13px] font-medium tracking-[0.06em] ${c.text}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>{c.mark}</svg>
      {c.label}
    </span>
  );
}
