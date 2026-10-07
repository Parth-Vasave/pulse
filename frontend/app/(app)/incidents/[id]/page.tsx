"use client";

import { useParams } from "next/navigation";
import { Stat, StatRow } from "@/components/Stat";
import { Timeline } from "@/components/Timeline";
import { FailMark, PassMark } from "@/components/icons";
import { BackLink, ErrorState, LinkButton, Section, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { formatDuration, formatTime } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<IncidentDetail>(`/incidents/${id}`, 10000);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message="This incident could not be found." onRetry={reload} />;
  const open = data.status === "open";
  return (
    <>
      <BackLink href="/incidents">Incidents</BackLink>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{data.monitor_name}: {open ? "ongoing incident" : "resolved incident"}</h1>
          <p className={`mt-2 inline-flex items-center gap-1.5 text-[15px] ${open ? "text-down" : "text-muted"}`}>
            {open ? <FailMark /> : <PassMark />}
            Started {formatTime(data.started_at, true)} · {formatDuration(data.duration_seconds)}{open ? " and counting" : " total"}
          </p>
        </div>
        <LinkButton href={`/monitors/${data.monitor_id}`}>View monitor</LinkButton>
      </div>

      <StatRow cols="md:grid-cols-4">
        <Stat label="Started" value={formatTime(data.started_at)} />
        <Stat label="Resolved" value={data.resolved_at ? formatTime(data.resolved_at) : "Not yet"} />
        <Stat label="Consecutive failures" value={String(data.failure_count)} />
        <Stat label="Consecutive passes" value={String(data.recovery_count)} />
      </StatRow>

      <Section className="mt-12" title="Root cause">
        <p className="max-w-prose font-mono text-[15px] leading-6 text-ink">{data.reason}</p>
      </Section>
      <Section className="mt-12" title="Timeline" description="Every state change, check and notification, in order.">
        <Timeline events={data.events} />
      </Section>
    </>
  );
}
