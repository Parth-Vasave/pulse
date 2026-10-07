"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { AvailabilityChart, ErrorRateChart, ResponseTimeChart } from "@/components/Charts";
import { Stat, StatRow } from "@/components/Stat";
import { StatusBadge } from "@/components/StatusBadge";
import { FailMark, PassMark, PauseIcon, PencilIcon, PlayIcon, RefreshIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { BackLink, Button, EmptyState, ErrorState, LinkButton, Section, SegmentedControl, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { ERROR_LABELS, catalogNo, formatDuration, formatMs, formatPercent, formatTime, timeAgo } from "@/lib/format";
import type { CheckResult, Monitor, MonitorStats, TimeRange } from "@/lib/types";

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1 hour" }, { value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" },
];
const FIRST_CHECKS = 15;

export default function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<TimeRange>("24h");
  const [toggling, setToggling] = useState(false);
  const [allChecks, setAllChecks] = useState(false);
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
  const rows = allChecks ? checks.data : checks.data?.slice(0, FIRST_CHECKS);

  return (
    <>
      <BackLink href="/dashboard">Dashboard</BackLink>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{m.name}</h1>
            <span className="font-mono text-sm text-muted">{catalogNo(m.id)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusBadge status={m.display_status} />
            <span className="break-all font-mono text-sm text-muted">{m.method} {m.url}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => togglePaused(m)} loading={toggling} icon={m.enabled ? <PauseIcon /> : <PlayIcon />}>{m.enabled ? "Pause" : "Resume"}</Button>
          <LinkButton href={`/monitors/${m.id}/edit`} icon={<PencilIcon />}>Edit</LinkButton>
        </div>
      </div>

      <StatRow cols="md:grid-cols-4">
        <Stat label="Last check" value={timeAgo(m.last_checked_at)} hint={`Every ${m.interval_seconds}s`} />
        <Stat label="Current response" value={formatMs(m.last_response_time_ms)} />
        <Stat label="Uptime 7d" value={formatPercent(stats.data?.uptime["7d"])} />
        <Stat label="Uptime 30d" value={formatPercent(stats.data?.uptime["30d"])} />
      </StatRow>

      <Section className="mt-12" title="Performance" description="Availability and percentiles are time-weighted over the selected range."
        actions={<SegmentedControl label="Time range" value={range} onChange={setRange} options={RANGES} />}>
        {stats.error && !stats.data ? <ErrorState message="Could not load statistics." onRetry={stats.reload} /> : (
          <>
            <StatRow cols="md:grid-cols-5">
              <Stat label={`Uptime ${range}`} value={formatPercent(s?.uptime_percentage)} hint={s ? (s.covered_seconds ? `Down ${formatDuration(s.downtime_seconds)} of ${formatDuration(s.covered_seconds)} observed` : "No observed time") : undefined} />
              <Stat label="Average" value={formatMs(s?.avg_response_time_ms)} />
              <Stat label="P50" value={formatMs(s?.p50_response_time_ms)} />
              <Stat label="P95" value={formatMs(s?.p95_response_time_ms)} />
              <Stat label="P99" value={formatMs(s?.p99_response_time_ms)} />
            </StatRow>
            <div className="mt-8 grid gap-x-10 gap-y-10 lg:grid-cols-2">
              <div className="lg:col-span-2"><ResponseTimeChart data={stats.data?.series ?? []} range={range} /></div>
              <AvailabilityChart data={stats.data?.series ?? []} range={range} />
              <ErrorRateChart data={stats.data?.series ?? []} range={range} />
            </div>
          </>
        )}
      </Section>

      <Section className="mt-12" title="Recent checks" description="Every check is stored. The newest is first."
        actions={<Button variant="ghost" size="sm" icon={<RefreshIcon />} onClick={() => { monitor.reload(); stats.reload(); checks.reload(); }}>Refresh now</Button>}>
        {checks.data?.length === 0 ? (
          <EmptyState title="No checks yet" body="The first check runs within a few seconds of creating the monitor." />
        ) : (
          <>
            <div className="relative -mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[40rem] text-left text-[15px]">
                <caption className="sr-only">Most recent checks</caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="caps py-2 pr-4 font-normal">Time</th>
                    <th scope="col" className="caps py-2 pr-4 font-normal">Result</th>
                    <th scope="col" className="caps py-2 pr-4 font-normal">HTTP</th>
                    <th scope="col" className="caps py-2 pr-4 text-right font-normal">Response</th>
                    <th scope="col" className="caps py-2 font-normal">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.map((c) => (
                    <tr key={c.id} className="border-b border-line">
                      <td className="whitespace-nowrap py-2 pr-4 font-mono text-sm text-muted">{formatTime(c.checked_at, true)}</td>
                      <td className="py-2 pr-4">
                        <span className={`inline-flex items-center gap-1.5 ${c.success ? "text-ink-2" : "text-down"}`}>
                          {c.success ? <PassMark className="text-muted" /> : <FailMark />}{c.success ? "Passed" : "Failed"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-sm">{c.status_code ?? "–"}</td>
                      <td className="py-2 pr-4 text-right font-mono text-sm">{formatMs(c.response_time_ms)}</td>
                      <td className="py-2 text-muted">{c.error_type ? `${ERROR_LABELS[c.error_type] ?? c.error_type}${c.error_message ? `: ${c.error_message}` : ""}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(checks.data?.length ?? 0) > FIRST_CHECKS && (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setAllChecks((v) => !v)} aria-expanded={allChecks}>
                {allChecks ? `Show the latest ${FIRST_CHECKS}` : `Show all ${checks.data?.length}`}
              </Button>
            )}
          </>
        )}
      </Section>
    </>
  );
}
