"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AvailabilityChart, ErrorRateChart, ResponseTimeChart } from "@/components/Charts";
import { Stat } from "@/components/Stat";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { ERROR_LABELS, formatMs, formatPercent, formatTime, timeAgo } from "@/lib/format";
import type { CheckResult, Monitor, MonitorStats, TimeRange } from "@/lib/types";

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1 hour" }, { value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" },
];

export default function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<TimeRange>("24h");
  const monitor = useApi<Monitor>(`/monitors/${id}`, 10000);
  const stats = useApi<MonitorStats>(`/monitors/${id}/stats?range=${range}`, 15000);
  const checks = useApi<CheckResult[]>(`/monitors/${id}/checks?limit=50`, 10000);

  if (monitor.loading && !monitor.data) return <Spinner />;
  if (monitor.error || !monitor.data) return <ErrorState message="This monitor could not be found." onRetry={monitor.reload} />;
  const m = monitor.data;
  const s = stats.data?.summary;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/" className="text-muted hover:text-ink">← Dashboard</Link></p>
      <PageHeader title={m.name} sub={`${m.method} ${m.url}`}>
        <StatusBadge status={m.display_status} />
        <Link href={`/monitors/${m.id}/edit`} className="rounded-md border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-paused-bg">Edit</Link>
      </PageHeader>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Last check" value={timeAgo(m.last_checked_at)} hint={`Every ${m.interval_seconds}s`} />
        <Stat label="Current response" value={formatMs(m.last_response_time_ms)} />
        <Stat label="Uptime (24h)" value={formatPercent(stats.data?.uptime["24h"] ?? m.uptime_24h)} />
        <Stat label="Uptime (7d / 30d)" value={`${formatPercent(stats.data?.uptime["7d"], 1)} / ${formatPercent(stats.data?.uptime["30d"], 1)}`} />
      </dl>

      <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Performance</h2>
        <div role="group" aria-label="Time range" className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {RANGES.map((r) => (
            <button key={r.value} onClick={() => setRange(r.value)} aria-pressed={range === r.value}
              className={`rounded-md px-3 py-1 text-sm ${range === r.value ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>{r.label}</button>
          ))}
        </div>
      </div>

      {stats.error && !stats.data ? <ErrorState message="Could not load statistics." onRetry={stats.reload} /> : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={`Uptime (${range})`} value={formatPercent(s?.uptime_percentage)} hint={s ? `${s.successful_checks} of ${s.total_checks} checks` : undefined} />
            <Stat label="Average" value={formatMs(s?.avg_response_time_ms)} />
            <Stat label="P50" value={formatMs(s?.p50_response_time_ms)} />
            <Stat label="P95" value={formatMs(s?.p95_response_time_ms)} />
            <Stat label="P99" value={formatMs(s?.p99_response_time_ms)} />
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2"><ResponseTimeChart data={stats.data?.series ?? []} range={range} /></div>
            <AvailabilityChart data={stats.data?.series ?? []} range={range} />
            <ErrorRateChart data={stats.data?.series ?? []} range={range} />
          </div>
        </>
      )}

      <h2 className="mb-3 mt-10 text-lg font-semibold">Recent checks</h2>
      <Card className="overflow-hidden">
        {checks.data?.length === 0 ? (
          <EmptyState title="No checks yet" body="The first check runs within a few seconds of creating the monitor." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Most recent checks</caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr><th scope="col" className="px-4 py-3 font-medium">Time</th><th scope="col" className="px-4 py-3 font-medium">Result</th><th scope="col" className="px-4 py-3 font-medium">HTTP</th><th scope="col" className="px-4 py-3 font-medium">Response</th><th scope="col" className="px-4 py-3 font-medium">Error</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {checks.data?.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 text-muted">{formatTime(c.checked_at, true)}</td>
                    <td className="px-4 py-2.5"><span className={c.success ? "text-up" : "text-down"}>{c.success ? "✓ Passed" : "✕ Failed"}</span></td>
                    <td className="px-4 py-2.5">{c.status_code ?? "–"}</td>
                    <td className="px-4 py-2.5">{formatMs(c.response_time_ms)}</td>
                    <td className="px-4 py-2.5 text-muted">{c.error_type ? `${ERROR_LABELS[c.error_type] ?? c.error_type}${c.error_message ? `: ${c.error_message}` : ""}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-4"><Button variant="ghost" onClick={() => { monitor.reload(); stats.reload(); checks.reload(); }}>Refresh now</Button></div>
    </>
  );
}
