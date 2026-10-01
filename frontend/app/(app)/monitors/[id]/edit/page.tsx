"use client";

import { useParams, useRouter } from "next/navigation";
import { MonitorForm } from "@/components/MonitorForm";
import { ErrorState, PageHeader, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { fromMonitor } from "@/lib/monitorForm";
import type { Monitor } from "@/lib/types";

export default function EditMonitor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Monitor>(`/monitors/${id}`);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message="This monitor could not be found." onRetry={reload} />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${data.name}`} />
      <MonitorForm editing initial={fromMonitor(data)} submitLabel="Save changes" onCancel={() => router.push(`/monitors/${id}`)}
        onSubmit={async (payload) => { await api(`/monitors/${id}`, { method: "PATCH", json: payload }); router.push(`/monitors/${id}`); }} />
    </div>
  );
}
