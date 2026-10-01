"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Timeline } from "@/components/Timeline";
import { ArrowLeftIcon } from "@/components/icons";
import { Card, ErrorState, LinkButton, PageHeader, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { formatDuration, formatTime } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<IncidentDetail>(`/incidents/${id}`, 10000);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message="This incident could not be found." onRetry={reload} />;
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/incidents" className="inline-flex items-center gap-1.5 text-muted hover:text-ink"><ArrowLeftIcon width={14} height={14} />Incidents</Link></p>
      <PageHeader title={`${data.monitor_name}: ${data.status === "open" ? "ongoing incident" : "resolved incident"}`}
        sub={`Started ${formatTime(data.started_at, true)} · ${formatDuration(data.duration_seconds)}${data.status === "open" ? " and counting" : " total"}`}>
        <LinkButton href={`/monitors/${data.monitor_id}`}>View monitor</LinkButton>
      </PageHeader>
      <Card className="mb-6 p-5"><h2 className="text-sm font-medium text-muted">Root cause</h2><p className="mt-1">{data.reason}</p></Card>
      <Card className="p-6"><h2 className="mb-5 font-semibold">Timeline</h2><Timeline events={data.events} /></Card>
    </>
  );
}
