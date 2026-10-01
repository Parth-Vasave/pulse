"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Heartbeat } from "@/components/Heartbeat";
import { HealthBanner } from "@/components/HealthBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { formatMs, formatPercent, timeAgo } from "@/lib/format";
import type { DashboardSummary, Monitor } from "@/lib/types";

export default function Dashboard() {
  const router = useRouter();
  const summary = useApi<DashboardSummary>("/dashboard/summary", 10000);
  const monitors = useApi<Monitor[]>("/monitors", 10000);
  const beats = useApi<Record<string, boolean[]>>("/monitors/heartbeats", 10000);
  const [deleting, setDeleting] = useState<Monitor | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggle(m: Monitor) {
    setActionError(null);
    try {
      await api(`/monitors/${m.id}`, { method: "PATCH", json: { enabled: !m.enabled } });
      monitors.reload(); summary.reload();
    } catch (e) { setActionError(describeError(e)); }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/monitors/${deleting.id}`, { method: "DELETE" });
      setDeleting(null); monitors.reload(); summary.reload();
    } catch (e) { setActionError(describeError(e)); setDeleting(null); }
    setBusy(false);
  }

  return (
    <>
      <PageHeader title="Dashboard" sub="Live status of everything you monitor. Refreshes every 10 seconds.">
        <Button variant="primary" onClick={() => router.push("/monitors/new")}>Add monitor</Button>
      </PageHeader>

      {summary.data ? <HealthBanner s={summary.data} /> : summary.error ? <ErrorState message="Could not load the summary." onRetry={summary.reload} /> : <Spinner />}
      {actionError && <div className="mt-4"><ErrorState message={actionError} /></div>}

      <Card className="mt-6 overflow-hidden">
        {monitors.loading && !monitors.data ? <Spinner label="Loading monitors" /> :
         monitors.error && !monitors.data ? <div className="p-4"><ErrorState message="Could not load monitors." onRetry={monitors.reload} /></div> :
         monitors.data?.length === 0 ? (
          <EmptyState title="Monitor your first API" body="Add a URL and Pulse checks it on a schedule, opens an incident when it fails repeatedly, and alerts you when it recovers."
            action={<Button variant="primary" onClick={() => router.push("/monitors/new")}>Add monitor</Button>} />
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
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => toggle(m)} aria-label={`${m.enabled ? "Pause" : "Resume"} ${m.name}`}>{m.enabled ? "Pause" : "Resume"}</Button>
                        <Button variant="ghost" onClick={() => router.push(`/monitors/${m.id}/edit`)} aria-label={`Edit ${m.name}`}>Edit</Button>
                        <Button variant="ghost" className="text-down" onClick={() => setDeleting(m)} aria-label={`Delete ${m.name}`}>Delete</Button>
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
