"use client";

import { useRouter } from "next/navigation";
import { MonitorForm } from "@/components/MonitorForm";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import type { Monitor } from "@/lib/types";

export default function NewMonitor() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add monitor" sub="Pulse will check this endpoint on your schedule from our workers." />
      <MonitorForm submitLabel="Create monitor" onCancel={() => router.push("/")}
        onSubmit={async (payload) => { const m = await api<Monitor>("/monitors", { method: "POST", json: payload }); router.push(`/monitors/${m.id}`); }} />
    </div>
  );
}
