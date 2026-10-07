"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ERROR_SERIES, errorBreakdown, formatMs } from "@/lib/format";
import type { SeriesPoint, TimeRange } from "@/lib/types";

const axis = { stroke: "var(--muted)", fontSize: 13, fontFamily: "var(--font-mono)", tickLine: false, axisLine: false } as const;
const grid = <CartesianGrid stroke="var(--line)" vertical={false} />;

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
    <div className="rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm shadow-[0_8px_24px_-8px_rgb(0_0_0/0.3)]">
      <div className="text-muted">{new Date(label).toLocaleString()}</div>
      <div className="mt-0.5 font-mono text-[15px] text-ink">{fmt(payload[0].value)}</div>
    </div>
  );
}

function ChartCard({ title, description, children, table }: { title: string; description: string; children: React.ReactNode; table: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="min-w-0" aria-label={title}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-medium text-ink">{title}</h3>
          <p className="text-sm text-muted">{description}</p>
        </div>
        <button onClick={() => setAsTable((t) => !t)} className="-mr-1.5 rounded px-1.5 py-0.5 text-sm text-muted transition-colors hover:bg-raised hover:text-ink" aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>
      {asTable ? <div className="max-h-64 overflow-auto">{table}</div> : <div className="h-56">{children}</div>}
    </section>
  );
}

function DataTable({ rows, header }: { rows: [string, string][]; header: [string, string] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead><tr><th scope="col" className="caps py-1.5 font-normal">{header[0]}</th><th scope="col" className="caps py-1.5 font-normal">{header[1]}</th></tr></thead>
      <tbody>{rows.map(([a, b]) => <tr key={a} className="border-t border-line"><td className="py-1.5 text-muted">{a}</td><td className="py-1.5 font-mono">{b}</td></tr>)}</tbody>
    </table>
  );
}

const empty = <div className="grid h-full place-items-center rounded-md border border-dashed border-line-strong text-[15px] text-muted">No checks in this period yet.</div>;

export function ResponseTimeChart({ data, range }: { data: SeriesPoint[]; range: TimeRange }) {
  const pts = data.filter((p) => p.avg_response_time_ms != null);
  return (
    <ChartCard title="Response time" description="Average per interval"
      table={<DataTable header={["Time", "Avg response"]} rows={pts.map((p) => [new Date(p.timestamp).toLocaleString(), formatMs(p.avg_response_time_ms)])} />}>
      {pts.length === 0 ? empty : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey="timestamp" tickFormatter={tick(range)} {...axis} minTickGap={40} />
            <YAxis tickFormatter={(v) => `${v}ms`} width={56} {...axis} />
            <Tooltip content={<Tip fmt={formatMs} />} cursor={{ stroke: "var(--line-strong)" }} />
            <Line type="linear" dataKey="avg_response_time_ms" stroke="var(--chart)" strokeWidth={1.5} strokeLinejoin="round" dot={false} activeDot={{ r: 4, fill: "var(--chart)", stroke: "var(--canvas)", strokeWidth: 2 }} isAnimationActive={false} />
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
            {grid}
            <XAxis dataKey="timestamp" tickFormatter={tick(range)} {...axis} minTickGap={40} />
            <YAxis domain={[0, 100]} tickFormatter={fmt} width={48} {...axis} />
            <Tooltip content={<Tip fmt={fmt} />} cursor={{ stroke: "var(--line-strong)" }} />
            <Area type="stepAfter" dataKey="availability" stroke="var(--chart)" strokeWidth={1.5} fill="var(--chart)" fillOpacity={0.06} isAnimationActive={false} />
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
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-label="Legend">
            {hasErrors ? present.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5"><span className="inline-block h-2 w-3.5 rounded-[1px]" style={{ background: `var(--err-${s.key})` }} aria-hidden />{s.label}</li>
            )) : <li>No failed checks in this period.</li>}
          </ul>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                {grid}
                <XAxis dataKey="timestamp" tickFormatter={tick(range)} {...axis} minTickGap={40} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={48} {...axis} />
                <Tooltip content={<BreakdownTip />} cursor={{ fill: "var(--raised)" }} />
                {ERROR_SERIES.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} stackId="e" fill={`var(--err-${s.key})`} stroke="var(--canvas)" strokeWidth={1}
                    radius={i === ERROR_SERIES.length - 1 ? [2, 2, 0, 0] : 0} isAnimationActive={false} />
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
    <div className="rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm shadow-[0_8px_24px_-8px_rgb(0_0_0/0.3)]">
      <div className="text-muted">{new Date(label).toLocaleString()}</div>
      <div className="mt-0.5 text-[15px] font-medium text-ink">{Number(total.toFixed(1))}% of {checks} {checks === 1 ? "check" : "checks"} failed</div>
      {parts.map((p) => (
        <div key={p.dataKey} className="mt-0.5 flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-[1px]" style={{ background: `var(--err-${p.dataKey})` }} aria-hidden />
          {ERROR_SERIES.find((s) => s.key === p.dataKey)?.label}: {Number(p.value.toFixed(1))}%
        </div>
      ))}
    </div>
  );
}
