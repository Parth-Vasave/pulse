import { formatTime } from "@/lib/format";
import type { IncidentEvent } from "@/lib/types";

const TONE: Record<string, { mark: string; text: string }> = {
  first_failure: { mark: "bg-down", text: "text-down" }, failure: { mark: "bg-down", text: "text-ink" },
  incident_created: { mark: "bg-down", text: "text-down" }, notification_failed: { mark: "bg-warn", text: "text-warn" },
  notification_sent: { mark: "bg-faint", text: "text-ink-2" }, recovery_check: { mark: "bg-ink-2", text: "text-ink" },
  recovered: { mark: "bg-ink", text: "text-ink" }, incident_resolved: { mark: "bg-ink", text: "text-ink" },
};

/** Genuinely sequential content, so an ordered list is the right structure. Time sits in its own column, like a log. */
export function Timeline({ events, formatAt = (iso) => formatTime(iso, true) }: { events: IncidentEvent[]; formatAt?: (at: string) => string }) {
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => {
        const t = TONE[e.event_type] ?? { mark: "bg-faint", text: "text-ink" };
        const last = i === events.length - 1;
        return (
          <li key={i} className="grid grid-cols-[9.5rem_1rem_minmax(0,1fr)] gap-x-3 max-sm:grid-cols-[1rem_minmax(0,1fr)]">
            <time dateTime={e.occurred_at} className="pt-[3px] text-right font-mono text-sm text-muted max-sm:col-start-2 max-sm:row-start-1 max-sm:text-left">{formatAt(e.occurred_at)}</time>
            <span className="relative flex justify-center max-sm:col-start-1 max-sm:row-span-2 max-sm:row-start-1" aria-hidden>
              <span className={`relative z-10 mt-[7px] h-[7px] w-[7px] rounded-[2px] ${t.mark}`} />
              {!last && <span className="absolute bottom-0 top-[7px] w-px bg-line-strong" />}
            </span>
            <p className={`pb-5 text-[15px] ${t.text} max-sm:col-start-2`}>{e.message}</p>
          </li>
        );
      })}
    </ol>
  );
}
