"use client";

import Link from "next/link";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { formatDuration, formatTime } from "@/lib/format";
import type { Incident } from "@/lib/types";

function IncidentTable({ items }: { items: Incident[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-line text-xs text-muted">
          <tr><th scope="col" className="px-4 py-3 font-medium">Monitor</th><th scope="col" className="px-4 py-3 font-medium">Status</th><th scope="col" className="px-4 py-3 font-medium">Started</th><th scope="col" className="px-4 py-3 font-medium">Duration</th><th scope="col" className="px-4 py-3 font-medium">Root cause</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((i) => (
            <tr key={i.id} className="hover:bg-canvas/60">
              <td className="px-4 py-3"><Link href={`/incidents/${i.id}`} className="font-medium hover:text-accent">{i.monitor_name}</Link></td>
              <td className="px-4 py-3"><span className={i.status === "open" ? "font-semibold text-down" : "text-up"}>{i.status === "open" ? "✕ Ongoing" : "✓ Resolved"}</span></td>
              <td className="px-4 py-3 text-muted">{formatTime(i.started_at, true)}</td>
              <td className="px-4 py-3">{formatDuration(i.duration_seconds)}{i.status === "open" && " and counting"}</td>
              <td className="max-w-[22rem] truncate px-4 py-3 text-muted" title={i.reason}>{i.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Incidents() {
  const open = useApi<Incident[]>("/incidents?status=open", 10000);
  const resolved = useApi<Incident[]>("/incidents?status=resolved&limit=50", 30000);
  return (
    <>
      <PageHeader title="Incidents" sub="An incident opens after repeated failed checks and resolves automatically when the API recovers." />
      <h2 className="mb-3 text-lg font-semibold">Active</h2>
      <Card className="overflow-hidden">
        {open.loading && !open.data ? <Spinner /> : open.error && !open.data ? <div className="p-4"><ErrorState message="Could not load incidents." onRetry={open.reload} /></div> :
          open.data?.length ? <IncidentTable items={open.data} /> : <EmptyState title="No active incidents" body="Everything you monitor is responding as expected." />}
      </Card>
      <h2 className="mb-3 mt-10 text-lg font-semibold">Resolved</h2>
      <Card className="overflow-hidden">
        {resolved.loading && !resolved.data ? <Spinner /> :
          resolved.data?.length ? <IncidentTable items={resolved.data} /> : <EmptyState title="No resolved incidents yet" body="Past outages appear here with their duration and cause." />}
      </Card>
    </>
  );
}
