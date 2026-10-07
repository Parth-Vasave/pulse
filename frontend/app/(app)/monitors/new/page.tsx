"use client";

import { useRouter } from "next/navigation";
import { MonitorForm } from "@/components/MonitorForm";
import { BackLink, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import type { Monitor } from "@/lib/types";

export default function NewMonitor() {
  const router = useRouter();
  return (
    <div className="max-w-4xl">
      <BackLink href="/dashboard">Dashboard</BackLink>
      <PageHeader title="Add monitor" sub="Pulse will check this endpoint on your schedule from our workers." />
      <MonitorForm submitLabel="Create monitor" onCancel={() => router.push("/dashboard")}
        onSubmit={async (payload) => { const m = await api<Monitor>("/monitors", { method: "POST", json: payload }); router.push(`/monitors/${m.id}`); }} />
    </div>
  );
}
