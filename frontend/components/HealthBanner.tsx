import type { DashboardSummary } from "@/lib/types";
import { formatPercent } from "@/lib/format";

/** The one thing you should know in the first second, said in words. */
export function HealthBanner({ s }: { s: DashboardSummary }) {
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
  const bg = { up: "bg-up-bg text-up", down: "bg-down-bg text-down", paused: "bg-paused-bg text-paused" }[tone];
  return (
    <section aria-label="Overall health" className={`rounded-lg p-6 ${bg}`}>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <p role="status" className="text-2xl font-semibold tracking-tight">{headline}</p>
          <p className="mt-1 text-sm opacity-90">{detail}</p>
        </div>
        <dl className="flex gap-8 text-ink">
          <Stat label="Uptime, last 24h" value={formatPercent(s.overall_uptime_24h)} />
          <Stat label="Active incidents" value={String(s.active_incidents)} />
        </dl>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  );
}
