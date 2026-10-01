import type { DisplayStatus } from "@/lib/types";

// Status is never color-only: each state has its own icon shape and a text label.
const CONFIG: Record<DisplayStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  up: {
    label: "UP", cls: "bg-up-bg text-up",
    icon: <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  down: {
    label: "DOWN", cls: "bg-down-bg text-down",
    icon: <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  },
  paused: {
    label: "PAUSED", cls: "bg-paused-bg text-paused",
    icon: <path d="M5.5 4v8M10.5 4v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  },
  unknown: {
    label: "PENDING", cls: "bg-paused-bg text-paused",
    icon: <circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="2.5 2.5" />,
  },
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const c = CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${c.cls}`}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>{c.icon}</svg>
      {c.label}
    </span>
  );
}
