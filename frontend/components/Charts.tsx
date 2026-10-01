"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ERROR_SERIES, errorBreakdown, formatMs } from "@/lib/format";
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
  const fmt = (v: number) => `${Number(v.toFixed(1))}%`;
  const rows = data.map((p) => ({ timestamp: p.timestamp, total: p.error_rate, checks: p.checks, ...errorBreakdown(p.errors, p.checks) }));
  const present = ERROR_SERIES.filter((s) => rows.some((r) => (((r as Record<string, unknown>)[s.key] as number | undefined) ?? 0) > 0));
  const hasErrors = present.length > 0;

  return (
    <ChartCard title="Errors by cause" description="Share of checks that failed, split by what went wrong"
      table={<DataTable header={["Time", "Error rate (by cause)"]} rows={data.map((p) => [new Date(p.timestamp).toLocaleString(),
        p.error_rate === 0 ? "0%" : `${fmt(p.error_rate)} (${Object.entries(p.errors).map(([k, v]) => `${k}: ${v}`).join(", ")})`])} />}>
      {data.length === 0 ? empty : (
        <div className="flex h-full flex-col">
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
            {hasErrors ? present.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `var(--err-${s.key})` }} aria-hidden />{s.label}</li>
            )) : <li>No failed checks in this period.</li>}
          </ul>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="timestamp" tickFormatter={tick(range)} {...axis} minTickGap={32} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={48} {...axis} />
                <Tooltip content={<BreakdownTip />} cursor={{ fill: "var(--paused-bg)" }} />
                {ERROR_SERIES.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} stackId="e" fill={`var(--err-${s.key})`} stroke="var(--surface)" strokeWidth={2}
                    radius={i === ERROR_SERIES.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

function BreakdownTip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; payload: { total: number; checks: number } }[]; label?: string }) {
  if (!active || !payload?.length || label == null) return null;
  const { total, checks } = payload[0].payload;
  const parts = payload.filter((p) => p.value > 0);
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="text-muted">{new Date(label).toLocaleString()}</div>
      <div className="mt-0.5 text-sm font-semibold">{Number(total.toFixed(1))}% of {checks} {checks === 1 ? "check" : "checks"} failed</div>
      {parts.map((p) => (
        <div key={p.dataKey} className="mt-0.5 flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `var(--err-${p.dataKey})` }} aria-hidden />
          {ERROR_SERIES.find((s) => s.key === p.dataKey)?.label}: {Number(p.value.toFixed(1))}%
        </div>
      ))}
    </div>
  );
}
