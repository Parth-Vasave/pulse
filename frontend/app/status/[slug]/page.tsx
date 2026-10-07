"use client";

import { useParams } from "next/navigation";
import { Wordmark } from "@/components/Logo";
import { FailMark, PassMark } from "@/components/icons";
import { useApi } from "@/hooks/useApi";
import { ErrorState, Spinner } from "@/components/ui";
import { formatDuration, formatPercent, formatTime } from "@/lib/format";
import type { PublicStatus } from "@/lib/types";

// Each state has its own mark shape and a word, never colour alone.
const LABEL: Record<string, { text: string; cls: string; mark: React.ReactNode }> = {
  operational: { text: "Operational", cls: "text-ink-2", mark: <circle cx="5" cy="5" r="3.5" fill="var(--up)" /> },
  degraded: { text: "Degraded", cls: "text-warn", mark: <path d="M5 1.5L9 8.5H1z" fill="var(--warn)" /> },
  outage: { text: "Outage", cls: "text-down", mark: <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="var(--down)" /> },
  paused: { text: "Paused", cls: "text-muted", mark: <path d="M3 1.5v7M7 1.5v7" stroke="var(--paused)" strokeWidth="1.6" strokeLinecap="round" /> },
  unknown: { text: "Unknown", cls: "text-muted", mark: <circle cx="5" cy="5" r="3.2" fill="none" stroke="var(--paused)" strokeWidth="1.3" strokeDasharray="2 1.6" /> },
};

const HEADLINE = { operational: "All systems operational", outage: "Some systems are down", degraded: "Some systems are degraded", unknown: "Status unavailable" } as const;
const DOT = { operational: "bg-up", outage: "bg-down pulse-down", degraded: "bg-warn", unknown: "bg-paused" } as const;

export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, error, loading } = useApi<PublicStatus>(`/public/status/${slug}`, 30000);
  if (loading && !data) return <main className="mx-auto max-w-2xl px-4"><Spinner /></main>;
  if (error || !data) return <main className="mx-auto max-w-2xl px-4 py-16"><ErrorState message="This status page doesn’t exist or isn’t public." /></main>;
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <div className="mb-14 flex items-center justify-between">
        <Wordmark />
        <span className="caps">Service status</span>
      </div>

      <h1 className="sr-only">Service status</h1>
      <p role="status" className={`flex items-center gap-3 text-[28px] font-semibold leading-tight tracking-[-0.03em] ${data.overall_status === "outage" ? "text-down" : "text-ink"}`}>
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[data.overall_status]}`} aria-hidden />
        {HEADLINE[data.overall_status]}
      </p>

      <ul className="mt-10 border-t border-line">
        {data.components.map((c) => {
          const l = LABEL[c.status] ?? LABEL.unknown;
          return (
            <li key={c.name} className="flex items-center justify-between gap-4 border-b border-line py-4">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="mt-0.5 text-sm text-muted">30-day uptime <span className="font-mono text-ink-2">{formatPercent(c.uptime_30d)}</span></div>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 text-[15px] ${l.cls}`}>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>{l.mark}</svg>{l.text}
              </span>
            </li>
          );
        })}
        {data.components.length === 0 && <li className="border-b border-line py-4 text-[15px] text-muted">No services are listed yet.</li>}
      </ul>

      <h2 className="mb-2 mt-14 text-[17px] font-medium tracking-tight">Recent incidents</h2>
      {data.incidents.length === 0 ? <p className="text-[15px] text-muted">No incidents in the last 14 days.</p> : (
        <ul className="border-t border-line">
          {data.incidents.map((i, n) => (
            <li key={n} className="border-b border-line py-4 text-[15px]">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{i.monitor}</span>
                <span className={`inline-flex items-center gap-1.5 ${i.status === "open" ? "text-down" : "text-ink-2"}`}>
                  {i.status === "open" ? <FailMark /> : <PassMark className="text-muted" />}{i.status === "open" ? "Ongoing" : "Resolved"}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-sm text-muted">{formatTime(i.started_at, true)}{i.resolved_at && ` · lasted ${formatDuration((new Date(i.resolved_at).getTime() - new Date(i.started_at).getTime()) / 1000)}`}</div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-16 text-sm text-muted">Powered by Pulse</p>
    </main>
  );
}
