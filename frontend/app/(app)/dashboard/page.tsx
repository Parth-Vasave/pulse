"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Heartbeat } from "@/components/Heartbeat";
import { HealthBanner } from "@/components/HealthBanner";
import { PulsarPlot } from "@/components/PulsarPlot";
import { StatusBadge } from "@/components/StatusBadge";
import { PauseIcon, PencilIcon, PlayIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { ConfirmDialog, EmptyState, ErrorState, IconButton, LinkButton, MenuSelect, SkeletonRows } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { MONITOR_SORTS, type MonitorSort, catalogNo, formatMs, formatPercent, timeAgo } from "@/lib/format";
import type { DashboardSummary, Monitor, TracePoint } from "@/lib/types";

export default function Dashboard() {
  const toast = useToast();
  const summary = useApi<DashboardSummary>("/dashboard/summary", 10000);
  const monitors = useApi<Monitor[]>("/monitors", 10000);
  const traces = useApi<Record<string, TracePoint[]>>("/monitors/traces", 10000);
  const [deleting, setDeleting] = useState<Monitor | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<MonitorSort>("status");
  const sorted = useMemo(() => [...(monitors.data ?? [])].sort(MONITOR_SORTS[sortBy].compare), [monitors.data, sortBy]);

  async function toggle(m: Monitor) {
    try {
      await api(`/monitors/${m.id}`, { method: "PATCH", json: { enabled: !m.enabled } });
      toast.success(m.enabled ? `Paused ${m.name}. Any open incident was closed.` : `Resumed ${m.name}. First check runs in a few seconds.`);
      monitors.reload(); summary.reload();
    } catch (e) { toast.error(describeError(e)); }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/monitors/${deleting.id}`, { method: "DELETE" });
      toast.success(`Deleted ${deleting.name}`);
      setDeleting(null); monitors.reload(); summary.reload();
    } catch (e) { toast.error(describeError(e)); setDeleting(null); }
    setBusy(false);
  }

  const addButton = <LinkButton href="/monitors/new" variant="primary" icon={<PlusIcon />}>Add monitor</LinkButton>;

  return (
    <>
      <h1 className="sr-only">Dashboard</h1>
      {summary.data ? <HealthBanner s={summary.data} action={addButton} note="Refreshes every 10 seconds." />
        : summary.error ? <ErrorState message="Could not load the summary." onRetry={summary.reload} />
        : <div className="flex justify-end" style={{ minHeight: 132 }}>{addButton}</div>}

      {sorted.length > 0 && (
        <div className="mt-12">
          <PulsarPlot monitors={sorted} traces={traces.data} active={active} onActive={setActive} />
        </div>
      )}

      <section aria-labelledby="monitors-h" className="mt-12">
        <div className="mb-1 flex items-baseline justify-between border-b border-line pb-3">
          <h2 id="monitors-h" className="text-[17px] font-medium tracking-tight">
            Monitors {monitors.data && <span className="ml-1 font-mono text-sm font-normal text-muted">{monitors.data.length}</span>}
          </h2>
          <MenuSelect label="Sorted by" value={sortBy} onChange={setSortBy}
            options={(Object.keys(MONITOR_SORTS) as MonitorSort[]).map((k) => ({ value: k, label: MONITOR_SORTS[k].label }))} />
        </div>
        {monitors.loading && !monitors.data ? <SkeletonRows rows={5} /> :
         monitors.error && !monitors.data ? <div className="pt-4"><ErrorState message="Could not load monitors." onRetry={monitors.reload} /></div> :
         monitors.data?.length === 0 ? (
          <EmptyState title="Monitor your first API" body="Add a URL and Pulse checks it on a schedule, opens an incident when it fails repeatedly, and alerts you when it recovers."
            action={addButton} />
         ) : (
          <div className="relative -mx-4 overflow-x-auto px-4">
            <table className="w-full text-left text-[15px] md:min-w-[56rem]">
              <caption className="sr-only">Monitors</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="caps py-2.5 pr-4 font-normal">Name</th>
                  <th scope="col" className="caps py-2.5 pr-4 font-normal">Status</th>
                  <th scope="col" className="caps py-2.5 pr-4 font-normal max-md:hidden">Recent checks</th>
                  <th scope="col" className="caps py-2.5 pr-4 text-right font-normal max-sm:hidden">Uptime 24h</th>
                  <th scope="col" className="caps py-2.5 pr-4 text-right font-normal">Response</th>
                  <th scope="col" className="caps py-2.5 pr-4 text-right font-normal max-md:hidden">Last check</th>
                  <th scope="col" className="caps py-2.5 text-right font-normal"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.id} onPointerEnter={(e) => { if (e.pointerType === "mouse") setActive(m.id); }} onPointerLeave={() => setActive(null)}
                    className={`group border-b border-line transition-colors duration-150 ${active === m.id ? "bg-raised/60" : ""}`}>
                    <td className="max-w-[20rem] py-3 pr-4 max-sm:max-w-[9.5rem]">
                      <div className="flex items-baseline gap-2">
                        <Link href={`/monitors/${m.id}`} className="truncate font-medium text-ink hover:underline max-sm:whitespace-normal">{m.name}</Link>
                        <span className="shrink-0 font-mono text-[13px] text-muted max-sm:hidden">{catalogNo(m.id)}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[13px] text-muted" title={m.url}>{m.method} {m.url}</div>
                    </td>
                    <td className="py-3 pr-4"><StatusBadge status={m.display_status} /></td>
                    <td className="py-3 pr-4 max-md:hidden"><Heartbeat results={traces.data?.[m.id]?.map((c) => c.ok)} count={30} /></td>
                    <td className="py-3 pr-4 text-right font-mono text-sm max-sm:hidden">{formatPercent(m.uptime_24h)}</td>
                    <td className="py-3 pr-4 text-right font-mono text-sm">{formatMs(m.last_response_time_ms)}</td>
                    <td className="py-3 pr-4 text-right text-sm text-muted max-md:hidden">{timeAgo(m.last_checked_at)}</td>
                    <td className="py-3">
                      <div className="flex justify-end opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                        <IconButton label={`${m.enabled ? "Pause" : "Resume"} ${m.name}`} onClick={() => toggle(m)}>
                          {m.enabled ? <PauseIcon /> : <PlayIcon />}
                        </IconButton>
                        <Link href={`/monitors/${m.id}/edit`} aria-label={`Edit ${m.name}`} title={`Edit ${m.name}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"><PencilIcon /></Link>
                        <IconButton label={`Delete ${m.name}`} variant="danger-ghost" onClick={() => setDeleting(m)}><TrashIcon /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name ?? "monitor"}?`}
        body="This permanently removes the monitor, its check history and its incidents. This can't be undone."
        confirmLabel="Delete monitor" busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)} />
    </>
  );
}
