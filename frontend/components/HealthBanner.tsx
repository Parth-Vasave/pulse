import type { DashboardSummary } from "@/lib/types";
import { formatPercent } from "@/lib/format";

/** The one thing you should know in the first second, said in words. It is the page's headline. */
export function HealthBanner({ s, action, note }: { s: DashboardSummary; action?: React.ReactNode; note?: string }) {
  let tone: "up" | "down" | "paused" = "up";
  let headline = "All systems operational";
  let detail = `${s.healthy_monitors} of ${s.total_monitors} monitors are up.`;
  if (s.total_monitors === 0) {
    tone = "paused"; headline = "No monitors yet"; detail = "Add an API to start tracking its health.";
  } else if (s.down_monitors > 0) {
    tone = "down";
    headline = `${s.down_monitors} ${s.down_monitors === 1 ? "monitor is" : "monitors are"} down`;
    detail = `${s.active_incidents} active ${s.active_incidents === 1 ? "incident" : "incidents"}. ${s.healthy_monitors} of ${s.total_monitors} monitors are up.`;
  }
  return (
    <section aria-label="Overall health" className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
      <div className="min-w-0">
        <p role="status" className={`text-[32px] font-semibold leading-tight tracking-[-0.035em] ${tone === "down" ? "text-down" : "text-ink"}`}>
          {headline}
        </p>
        <p className="mt-1.5 text-[15px] text-muted">{detail}{note && <span className="text-muted"> {note}</span>}</p>
        <dl className="mt-5 flex gap-8">
          <Readout label="Uptime, last 24h" value={formatPercent(s.overall_uptime_24h)} />
          <Readout label="Active incidents" value={String(s.active_incidents)} tone={s.active_incidents ? "text-down" : undefined} />
        </dl>
      </div>
      {action}
    </section>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="caps">{label}</dt>
      <dd className={`mt-0.5 font-mono text-lg tracking-tight ${tone ?? "text-ink"}`}>{value}</dd>
    </div>
  );
}
