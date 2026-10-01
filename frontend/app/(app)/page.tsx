"use client";

import Link from "next/link";
import { useState } from "react";
import { Heartbeat } from "@/components/Heartbeat";
import { HealthBanner } from "@/components/HealthBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { PauseIcon, PencilIcon, PlayIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { Card, ConfirmDialog, EmptyState, ErrorState, IconButton, LinkButton, PageHeader, SkeletonRows, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { formatMs, formatPercent, timeAgo } from "@/lib/format";
import type { DashboardSummary, Monitor } from "@/lib/types";

export default function Dashboard() {
  const toast = useToast();
  const summary = useApi<DashboardSummary>("/dashboard/summary", 10000);
  const monitors = useApi<Monitor[]>("/monitors", 10000);
  const beats = useApi<Record<string, boolean[]>>("/monitors/heartbeats", 10000);
  const [deleting, setDeleting] = useState<Monitor | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <>
      <PageHeader title="Dashboard" sub="Live status of everything you monitor. Refreshes every 10 seconds.">
        <LinkButton href="/monitors/new" variant="primary" icon={<PlusIcon />}>Add monitor</LinkButton>
      </PageHeader>

      {summary.data ? <HealthBanner s={summary.data} /> : summary.error ? <ErrorState message="Could not load the summary." onRetry={summary.reload} /> : <Spinner />}

      <Card className="mt-6 overflow-hidden">
        {monitors.loading && !monitors.data ? <SkeletonRows rows={5} /> :
         monitors.error && !monitors.data ? <div className="p-4"><ErrorState message="Could not load monitors." onRetry={monitors.reload} /></div> :
         monitors.data?.length === 0 ? (
          <EmptyState title="Monitor your first API" body="Add a URL and Pulse checks it on a schedule, opens an incident when it fails repeatedly, and alerts you when it recovers."
            action={<LinkButton href="/monitors/new" variant="primary" icon={<PlusIcon />}>Add monitor</LinkButton>} />
         ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Monitors</caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Recent checks</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Uptime (24h)</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Response</th>
                  <th scope="col" className="px-4 py-3 font-medium">Last checked</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {monitors.data?.map((m) => (
                  <tr key={m.id} className="hover:bg-canvas/60">
                    <td className="max-w-[18rem] px-4 py-3">
                      <Link href={`/monitors/${m.id}`} className="font-medium text-ink hover:text-accent">{m.name}</Link>
                      <div className="truncate text-xs text-muted" title={m.url}>{m.method} {m.url}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={m.display_status} /></td>
                    <td className="px-4 py-3"><Heartbeat results={beats.data?.[m.id]} count={30} /></td>
                    <td className="px-4 py-3 text-right">{formatPercent(m.uptime_24h)}</td>
                    <td className="px-4 py-3 text-right">{formatMs(m.last_response_time_ms)}</td>
                    <td className="px-4 py-3 text-muted">{timeAgo(m.last_checked_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-0.5">
                        <IconButton label={`${m.enabled ? "Pause" : "Resume"} ${m.name}`} onClick={() => toggle(m)}>
                          {m.enabled ? <PauseIcon /> : <PlayIcon />}
                        </IconButton>
                        <Link href={`/monitors/${m.id}/edit`} aria-label={`Edit ${m.name}`} title={`Edit ${m.name}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-paused-bg hover:text-ink"><PencilIcon /></Link>
                        <IconButton label={`Delete ${m.name}`} variant="danger-ghost" onClick={() => setDeleting(m)}><TrashIcon /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name ?? "monitor"}?`}
        body="This permanently removes the monitor, its check history and its incidents. This can't be undone."
        confirmLabel="Delete monitor" busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)} />
    </>
  );
}
