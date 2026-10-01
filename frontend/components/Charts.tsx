"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMs } from "@/lib/format";
import type { SeriesPoint, TimeRange } from "@/lib/types";

const axis = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false } as const;

function tick(range: TimeRange) {
  return (iso: string) => {
    const d = new Date(iso);
    return range === "1h" || range === "24h"
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
}

function Tip({ active, payload, label, fmt }: { active?: boolean; payload?: { value: number }[]; label?: string; fmt: (v: number) => string }) {
  if (!active || !payload?.length || label == null) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="text-muted">{new Date(label).toLocaleString()}</div>
      <div className="mt-0.5 text-sm font-semibold">{fmt(payload[0].value)}</div>
    </div>
  );
}

function ChartCard({ title, description, children, table }: { title: string; description: string; children: React.ReactNode; table: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-muted">{description}</p>
        </div>
        <button onClick={() => setAsTable((t) => !t)} className="rounded px-2 py-1 text-xs text-muted hover:text-ink" aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>
      {asTable ? <div className="max-h-64 overflow-auto">{table}</div> : <div className="h-56">{children}</div>}
    </section>
  );
}

function DataTable({ rows, header }: { rows: [string, string][]; header: [string, string] }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-muted"><tr><th scope="col" className="py-1 font-medium">{header[0]}</th><th scope="col" className="py-1 font-medium">{header[1]}</th></tr></thead>
      <tbody>{rows.map(([a, b]) => <tr key={a} className="border-t border-line"><td className="py-1">{a}</td><td className="py-1">{b}</td></tr>)}</tbody>
    </table>
  );
}

const empty = <div className="grid h-full place-items-center text-sm text-muted">No checks in this period yet.</div>;

export function ResponseTimeChart({ data, range }: { data: SeriesPoint[]; range: TimeRange }) {
  const pts = data.filter((p) => p.avg_response_time_ms != null);
  return (
    <ChartCard title="Response time" description="Average per interval"
      table={<DataTable header={["Time", "Avg response"]} rows={pts.map((p) => [new Date(p.timestamp).toLocaleString(), formatMs(p.avg_response_time_ms)])} />}>
      {pts.length === 0 ? empty : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={tick(range)} {...axis} minTickGap={32} />
            <YAxis tickFormatter={(v) => `${v}ms`} width={56} {...axis} />
            <Tooltip content={<Tip fmt={formatMs} />} cursor={{ stroke: "var(--muted)" }} />
            <Line type="monotone" dataKey="avg_response_time_ms" stroke="var(--chart)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function AvailabilityChart({ data, range }: { data: SeriesPoint[]; range: TimeRange }) {
  const fmt = (v: number) => `${v}%`;
  return (
    <ChartCard title="Availability" description="Share of checks that passed"
      table={<DataTable header={["Time", "Availability"]} rows={data.map((p) => [new Date(p.timestamp).toLocaleString(), fmt(p.availability)])} />}>
      {data.length === 0 ? empty : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={tick(range)} {...axis} minTickGap={32} />
            <YAxis domain={[0, 100]} tickFormatter={fmt} width={48} {...axis} />
            <Tooltip content={<Tip fmt={fmt} />} cursor={{ stroke: "var(--muted)" }} />
            <Area type="stepAfter" dataKey="availability" stroke="var(--chart)" strokeWidth={2} fill="var(--chart)" fillOpacity={0.12} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function ErrorRateChart({ data, range }: { data: SeriesPoint[]; range: TimeRange }) {
  const fmt = (v: number) => `${v}%`;
  return (
    <ChartCard title="Error rate" description="Share of checks that failed"
      table={<DataTable header={["Time", "Error rate"]} rows={data.map((p) => [new Date(p.timestamp).toLocaleString(), fmt(p.error_rate)])} />}>
      {data.length === 0 ? empty : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={tick(range)} {...axis} minTickGap={32} />
            <YAxis domain={[0, 100]} tickFormatter={fmt} width={48} {...axis} />
            <Tooltip content={<Tip fmt={fmt} />} cursor={{ fill: "var(--paused-bg)" }} />
            <Bar dataKey="error_rate" fill="var(--down)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
