"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { AvailabilityChart, ErrorRateChart, ResponseTimeChart } from "@/components/Charts";
import { Stat } from "@/components/Stat";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeftIcon, PauseIcon, PencilIcon, PlayIcon, RefreshIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { Button, Card, EmptyState, ErrorState, LinkButton, PageHeader, SegmentedControl, Spinner } from "@/components/ui";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { ERROR_LABELS, formatDuration, formatMs, formatPercent, formatTime, timeAgo } from "@/lib/format";
import type { CheckResult, Monitor, MonitorStats, TimeRange } from "@/lib/types";

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1 hour" }, { value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" },
];

export default function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<TimeRange>("24h");
  const [toggling, setToggling] = useState(false);
  const toast = useToast();
  const monitor = useApi<Monitor>(`/monitors/${id}`, 10000);
  const stats = useApi<MonitorStats>(`/monitors/${id}/stats?range=${range}`, 15000);
  const checks = useApi<CheckResult[]>(`/monitors/${id}/checks?limit=50`, 10000);

  async function togglePaused(m: Monitor) {
    setToggling(true);
    try {
      await api(`/monitors/${m.id}`, { method: "PATCH", json: { enabled: !m.enabled } });
      toast.success(m.enabled ? `Paused ${m.name}. Any open incident was closed.` : `Resumed ${m.name}. First check runs in a few seconds.`);
      monitor.reload();
    } catch (e) { toast.error(describeError(e)); }
    setToggling(false);
  }

  if (monitor.loading && !monitor.data) return <Spinner />;
  if (monitor.error || !monitor.data) return <ErrorState message="This monitor could not be found." onRetry={monitor.reload} />;
  const m = monitor.data;
  const s = stats.data?.summary;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/" className="inline-flex items-center gap-1.5 text-muted hover:text-ink"><ArrowLeftIcon width={14} height={14} />Dashboard</Link></p>
      <PageHeader title={m.name} sub={`${m.method} ${m.url}`}>
        <StatusBadge status={m.display_status} />
        <Button onClick={() => togglePaused(m)} loading={toggling} icon={m.enabled ? <PauseIcon /> : <PlayIcon />}>{m.enabled ? "Pause" : "Resume"}</Button>
        <LinkButton href={`/monitors/${m.id}/edit`} icon={<PencilIcon />}>Edit</LinkButton>
      </PageHeader>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Last check" value={timeAgo(m.last_checked_at)} hint={`Every ${m.interval_seconds}s`} />
        <Stat label="Current response" value={formatMs(m.last_response_time_ms)} />
        <Stat label="Uptime (24h)" value={formatPercent(stats.data?.uptime["24h"] ?? m.uptime_24h)} />
        <Stat label="Uptime (7d / 30d)" value={`${formatPercent(stats.data?.uptime["7d"], 1)} / ${formatPercent(stats.data?.uptime["30d"], 1)}`} />
      </dl>

      <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Performance</h2>
        <SegmentedControl label="Time range" value={range} onChange={setRange} options={RANGES} />
      </div>

      {stats.error && !stats.data ? <ErrorState message="Could not load statistics." onRetry={stats.reload} /> : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={`Uptime (${range})`} value={formatPercent(s?.uptime_percentage)} hint={s ? (s.covered_seconds ? `Down ${formatDuration(s.downtime_seconds)} of ${formatDuration(s.covered_seconds)} observed` : "No observed time") : undefined} />
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
      <div className="mt-4"><Button variant="ghost" size="sm" icon={<RefreshIcon />} onClick={() => { monitor.reload(); stats.reload(); checks.reload(); }}>Refresh now</Button></div>
    </>
  );
}
