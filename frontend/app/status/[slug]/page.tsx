"use client";

import { useParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { ErrorState, Spinner } from "@/components/ui";
import { formatDuration, formatPercent, formatTime } from "@/lib/format";
import type { PublicStatus } from "@/lib/types";

const LABEL: Record<string, { text: string; cls: string; icon: string }> = {
  operational: { text: "Operational", cls: "text-up", icon: "✓" },
  degraded: { text: "Degraded", cls: "text-warn", icon: "!" },
  outage: { text: "Outage", cls: "text-down", icon: "✕" },
  paused: { text: "Paused", cls: "text-paused", icon: "‖" },
  unknown: { text: "Unknown", cls: "text-paused", icon: "?" },
};

export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, error, loading } = useApi<PublicStatus>(`/public/status/${slug}`, 30000);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <main className="mx-auto max-w-2xl p-8"><ErrorState message="This status page doesn’t exist or isn’t public." /></main>;
  const banner = { operational: "bg-up-bg text-up", degraded: "bg-warn-bg text-warn", outage: "bg-down-bg text-down", unknown: "bg-paused-bg text-paused" }[data.overall_status];
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Service status</h1>
      <div role="status" className={`mb-8 rounded-lg p-5 text-lg font-semibold ${banner}`}>
        {data.overall_status === "operational" ? "All systems operational" : data.overall_status === "outage" ? "Some systems are down" : data.overall_status === "degraded" ? "Some systems are degraded" : "Status unavailable"}
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {data.components.map((c) => {
          const l = LABEL[c.status] ?? LABEL.unknown;
          return (
            <li key={c.name} className="flex items-center justify-between gap-4 p-4">
              <div><div className="font-medium">{c.name}</div><div className="text-xs text-muted">30-day uptime {formatPercent(c.uptime_30d)}</div></div>
              <span className={`font-semibold ${l.cls}`}><span aria-hidden>{l.icon} </span>{l.text}</span>
            </li>
          );
        })}
        {data.components.length === 0 && <li className="p-4 text-sm text-muted">No services are listed yet.</li>}
      </ul>
      <h2 className="mb-3 mt-10 text-lg font-semibold">Recent incidents</h2>
      {data.incidents.length === 0 ? <p className="text-sm text-muted">No incidents in the last 14 days.</p> : (
        <ul className="flex flex-col gap-3">
          {data.incidents.map((i, n) => (
            <li key={n} className="rounded-lg border border-line bg-surface p-4 text-sm">
              <div className="font-medium">{i.monitor} <span className={i.status === "open" ? "text-down" : "text-up"}>· {i.status === "open" ? "Ongoing" : "Resolved"}</span></div>
              <div className="text-muted">{formatTime(i.started_at, true)}{i.resolved_at && ` · lasted ${formatDuration((new Date(i.resolved_at).getTime() - new Date(i.started_at).getTime()) / 1000)}`}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
