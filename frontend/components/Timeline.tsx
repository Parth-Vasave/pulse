import { formatTime } from "@/lib/format";
import type { IncidentEvent } from "@/lib/types";

const TONE: Record<string, { dot: string; text: string }> = {
  first_failure: { dot: "bg-down", text: "text-down" }, failure: { dot: "bg-down", text: "text-down" },
  incident_created: { dot: "bg-down", text: "text-down" }, notification_failed: { dot: "bg-warn", text: "text-warn" },
  notification_sent: { dot: "bg-paused", text: "text-ink" }, recovery_check: { dot: "bg-up", text: "text-up" },
  recovered: { dot: "bg-up", text: "text-up" }, incident_resolved: { dot: "bg-up", text: "text-up" },
};

/** Genuinely sequential content, so an ordered list is the right structure. */
export function Timeline({ events }: { events: IncidentEvent[] }) {
  return (
    <ol className="relative flex flex-col gap-5 border-l border-line pl-6">
      {events.map((e, i) => {
        const t = TONE[e.event_type] ?? { dot: "bg-paused", text: "text-ink" };
        return (
          <li key={i} className="relative">
            <span className={`absolute -left-[1.85rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${t.dot}`} aria-hidden />
            <time dateTime={e.occurred_at} className="text-xs text-muted">{formatTime(e.occurred_at, true)}</time>
            <p className={`text-sm font-medium ${t.text}`}>{e.message}</p>
          </li>
        );
      })}
    </ol>
  );
}
