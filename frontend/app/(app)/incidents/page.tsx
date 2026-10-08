"use client";

import Link from "next/link";
import { FailMark, PassMark } from "@/components/icons";
import { EmptyState, ErrorState, PageHeader, Section, SkeletonRows } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { formatDuration, formatTime } from "@/lib/format";
import type { Incident } from "@/lib/types";

function IncidentTable({ items }: { items: Incident[] }) {
  return (
    <div className="relative -mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[40rem] text-left text-[15px]">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="caps py-2 pr-4 font-normal">Monitor</th>
            <th scope="col" className="caps py-2 pr-4 font-normal">Status</th>
            <th scope="col" className="caps py-2 pr-4 font-normal">Started</th>
            <th scope="col" className="caps py-2 pr-4 text-right font-normal">Duration</th>
            <th scope="col" className="caps py-2 font-normal">Root cause</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-line transition-colors hover:bg-raised/60">
              <td className="py-3 pr-4"><Link href={`/incidents/${i.id}`} className="font-medium text-ink hover:underline">{i.monitor_name}</Link></td>
              <td className="py-3 pr-4">
                <span className={`inline-flex items-center gap-1.5 ${i.status === "open" ? "font-medium text-down" : "text-ink-2"}`}>
                  {i.status === "open" ? <FailMark /> : <PassMark className="text-muted" />}{i.status === "open" ? "Ongoing" : "Resolved"}
                </span>
              </td>
              <td className="whitespace-nowrap py-3 pr-4 font-mono text-sm text-muted">{formatTime(i.started_at, true)}</td>
              <td className="whitespace-nowrap py-3 pr-4 text-right font-mono text-sm">{formatDuration(i.duration_seconds)}{i.status === "open" && <span className="text-down"> and counting</span>}</td>
              <td className="max-w-[24rem] truncate py-3 text-muted" title={i.reason}>{i.reason}</td>
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
      <Section title="Active" description={open.data?.length ? `${open.data.length} ongoing` : undefined}>
        {open.loading && !open.data ? <SkeletonRows rows={2} /> : open.error && !open.data ? <ErrorState message="Could not load incidents." onRetry={open.reload} /> :
          open.data?.length ? <IncidentTable items={open.data} /> : <EmptyState title="No active incidents" body="Everything you monitor is responding as expected." />}
      </Section>
      <Section className="mt-12" title="Resolved" description="The last 50, newest first.">
        {resolved.loading && !resolved.data ? <SkeletonRows rows={4} /> : resolved.error && !resolved.data ? <ErrorState message="Could not load incidents." onRetry={resolved.reload} /> :
          resolved.data?.length ? <IncidentTable items={resolved.data} /> : <EmptyState title="No resolved incidents yet" body="Past outages appear here with their duration and cause." />}
      </Section>
    </>
  );
}
