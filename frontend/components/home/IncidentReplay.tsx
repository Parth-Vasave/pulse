"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PauseIcon, PlayIcon, RefreshIcon } from "@/components/icons";
import { StatusBadge } from "@/components/StatusBadge";
import { Timeline } from "@/components/Timeline";
import { IconButton } from "@/components/ui";
import type { IncidentEvent } from "@/lib/types";

/*
 * A scripted replay of one outage, run through the same rules as backend/app/services/state_machine.py:
 * N consecutive failures open an incident, M consecutive passes resolve it, and a pass while up resets
 * the failure count. Event and alert wording matches what the backend writes. Latencies are synthetic.
 */

const OPEN_AFTER = 3;
const RESOLVE_AFTER = 2;
const INTERVAL_S = 30;
const TICK_MS = 500; // 30 s of replay clock every half second: 60x
const HOLD_MS = 3200;
const PRELOAD = 40;
const CLOCK_START = 9 * 3600 + 21 * 60; // 09:21:00 on the replay clock
const MONITOR = { name: "Demo switch", url: "http://demo-service:9000/switch" };
const CHANNEL = "On-call";

interface Check { ok: boolean; ms: number | null; code: number | null; error?: string }

const pass = (ms: number): Check => ({ ok: true, ms, code: 200 });
const http500 = (ms: number): Check => ({ ok: false, ms, code: 500, error: "Expected HTTP 200, got 500" });
const timeout: Check = { ok: false, ms: null, code: null, error: "Request timed out (ReadTimeout)" };

// Quiet history fills the lane on load, then the replay plays a blip, the outage and the recovery live.
const HISTORY = [44, 39, 52, 47, 41, 60, 45, 38, 56, 43, 49, 40, 66, 46, 42, 51, 39, 47, 58, 44, 41, 53, 45, 40, 62, 48, 43, 39, 55, 46, 42, 50, 38, 47, 57, 44, 41, 49, 45, 40];

const SCRIPT: Check[] = [
  ...HISTORY.map(pass),
  ...[42, 51].map(pass),
  timeout, // one blip: counted, never alerted
  ...[71, 46, 41, 49, 55].map(pass),
  ...[12, 9, 11, 10, 13, 9].map(http500),
  ...[88, 61, 48, 44, 50, 41, 46, 39, 57, 45].map(pass),
];

type Phase = "up" | "failing" | "down" | "recovering";

interface Step extends Check {
  i: number;
  at: number;
  down: boolean;
  counter?: string;
  marker?: "opened" | "resolved";
}

interface Alert { kind: "created" | "resolved"; at: number; lines: string[] }

const clock = (s: number) => [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");

function duration(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

const describe = (c: Check) => c.error ?? "check failed";

/** Run the first `n` checks of the script through the state machine. */
function replay(n: number) {
  let status = "up" as "up" | "down";
  let fails = 0, passes = 0, openedAt = 0;
  const steps: Step[] = [];
  const events: IncidentEvent[] = [];
  const alerts: Alert[] = [];

  SCRIPT.slice(0, n).forEach((c, i) => {
    const at = CLOCK_START + i * INTERVAL_S;
    const step: Step = { ...c, i, at, down: status === "down" };
    if (c.ok) {
      passes += 1;
      if (status === "down") {
        step.counter = `${passes}/${RESOLVE_AFTER}`;
        if (passes >= RESOLVE_AFTER) {
          status = "up"; fails = 0; step.marker = "resolved"; step.down = false;
          (passes > 1 ? steps.slice(-(passes - 1)) : []).forEach((r, k) => events.push({ occurred_at: clock(r.at), event_type: "recovery_check", message: `Recovery check ${k + 1}/${RESOLVE_AFTER} passed` }));
          events.push({ occurred_at: clock(at), event_type: "recovered", message: "API recovered" });
          events.push({ occurred_at: clock(at), event_type: "incident_resolved", message: "Incident resolved" });
          events.push({ occurred_at: clock(at), event_type: "notification_sent", message: `email notification sent to '${CHANNEL}'` });
          alerts.unshift({ kind: "resolved", at, lines: [`Subject: RECOVERED: ${MONITOR.name}`, `Monitor: ${MONITOR.name}`, `Downtime: ${duration(at - openedAt)}`] });
        }
      } else {
        fails = 0;
      }
    } else {
      passes = 0;
      fails += 1;
      if (status === "up") {
        step.counter = `${fails}/${OPEN_AFTER}`;
        if (fails >= OPEN_AFTER) {
          status = "down"; openedAt = at; step.marker = "opened"; step.down = true;
          const streak = [...(fails > 1 ? steps.slice(-(fails - 1)) : []), step];
          streak.forEach((r, k) => events.push({ occurred_at: clock(r.at), event_type: k ? "failure" : "first_failure", message: `${k ? `Failure #${k + 1}` : "First failure"}: ${describe(r)}` }));
          events.push({ occurred_at: clock(at), event_type: "incident_created", message: `Incident created after ${fails} consecutive failures` });
          events.push({ occurred_at: clock(at), event_type: "notification_sent", message: `email notification sent to '${CHANNEL}'` });
          alerts.unshift({ kind: "created", at, lines: [
            `Subject: INCIDENT: ${MONITOR.name}`, `Monitor: ${MONITOR.name}`, `URL: ${MONITOR.url}`,
            `Reason: ${fails} consecutive failures. Last error: ${describe(c)}`, `Started: ${clock(at).slice(0, 5)} UTC`,
          ] });
        }
      }
    }
    steps.push(step);
  });

  const phase: Phase = status === "down" ? (passes ? "recovering" : "down") : fails ? "failing" : "up";
  return { steps, events, alerts, phase, fails, passes, status };
}

const FINAL = SCRIPT.length;
const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const LANE_H = 132;
const TOP = 26; // room for the counters above the ticks

function tickHeight(c: Check) {
  if (!c.ok) return LANE_H - TOP;
  return Math.round(16 + Math.min(1, Math.max(0, ((c.ms ?? 40) - 35) / 60)) * 34);
}

const PHASES: { id: Phase; title: string; rule: string; mark: React.ReactNode }[] = [
  { id: "up", title: "Up", rule: "Every pass resets the failure count.", mark: <circle cx="5" cy="5" r="3.5" fill="var(--up)" /> },
  { id: "failing", title: "Failing", rule: `${OPEN_AFTER} failures in a row open an incident.`, mark: <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="var(--down)" strokeWidth="1.4" /> },
  { id: "down", title: "Down", rule: "One incident opens and the alert goes out once.", mark: <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="var(--down)" /> },
  { id: "recovering", title: "Recovering", rule: `${RESOLVE_AFTER} passes in a row resolve it.`, mark: <circle cx="5" cy="5" r="3.2" fill="none" stroke="var(--ink-2)" strokeWidth="1.3" strokeDasharray="2 1.6" /> },
];

export function IncidentReplay() {
  const [n, setN] = useState(PRELOAD);
  const [cycle, setCycle] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const lane = useRef<HTMLDivElement>(null);

  // Reduced motion: show the finished incident, still, until the visitor presses play.
  const reduced = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED).matches, () => false);
  const [started, setStarted] = useState(false);
  const still = reduced && !started;

  useEffect(() => {
    const el = lane.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Only run while on screen.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const running = playing && !still && visible && cursor === null;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => {
      if (n < FINAL) setN(n + 1);
      else { setN(PRELOAD); setCycle((c) => c + 1); }
    }, n < FINAL ? TICK_MS : HOLD_MS);
    return () => clearTimeout(t);
  }, [running, n]);

  const run = useMemo(() => replay(still ? FINAL : n), [still, n]);
  const windowSize = Math.min(44, Math.max(24, Math.floor(width / 27)));
  const pitch = width / windowSize;
  const shown = run.steps.slice(-windowSize);
  const x = (j: number) => width - (shown.length - j - 0.5) * pitch;
  const roomyLabels = pitch >= 26;
  const read = cursor !== null ? shown[cursor] : run.steps[run.steps.length - 1];

  function restart() { setN(PRELOAD); setCycle((c) => c + 1); setPlaying(true); setStarted(true); }

  function pointAt(clientX: number) {
    const box = lane.current?.getBoundingClientRect();
    if (!box || !shown.length) return;
    const j = Math.round((clientX - box.left - x(0)) / pitch);
    setCursor(Math.max(0, Math.min(shown.length - 1, j)));
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const last = shown.length - 1;
    const cur = cursor ?? last;
    setCursor(e.key === "Home" ? 0 : e.key === "End" ? last : Math.max(0, Math.min(last, cur + (e.key === "ArrowLeft" ? -1 : 1))));
  }

  return (
    <div ref={root}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-[17px] font-medium tracking-tight">{MONITOR.name}</h3>
            <span className="font-mono text-[13px] text-muted">PLS-001</span>
          </div>
          <p className="mt-0.5 font-mono text-sm text-muted"><span className="break-all">GET {MONITOR.url}</span> <span className="whitespace-nowrap">· every {INTERVAL_S} s</span></p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={run.status} />
          <span className="h-4 w-px bg-line-strong" aria-hidden />
          <div className="flex items-center">
            <IconButton label={playing && !still ? "Pause replay" : "Play replay"} onClick={() => (still ? restart() : setPlaying(!playing))}>
              {playing && !still ? <PauseIcon /> : <PlayIcon />}
            </IconButton>
            <IconButton label="Replay from the start" onClick={restart}><RefreshIcon /></IconButton>
          </div>
        </div>
      </div>

      <div ref={lane} tabIndex={0} role="group" onKeyDown={onKey}
        aria-label={`Replayed check history for ${MONITOR.name}. Use the arrow keys to read each check.`}
        onPointerMove={(e) => pointAt(e.clientX)} onPointerLeave={() => setCursor(null)} onBlur={() => setCursor(null)}
        className="replay-lane relative mt-6 cursor-crosshair touch-pan-y rounded-[2px]" style={{ height: LANE_H }}>
        {width > 0 && (
          <svg width={width} height={LANE_H} className="block overflow-visible" aria-hidden key={cycle}>
            {shown.map((s, j) => {
              const h = tickHeight(s);
              const bar = Math.max(2, Math.min(4, pitch * 0.32));
              const showCounter = s.counter && (roomyLabels || j === shown.length - 1);
              return (
                <g key={s.i} className="replay-step" style={{ transform: `translateX(${x(j)}px)` }}>
                  {s.down && (
                    <>
                      <rect x={-pitch / 2} y={TOP - 6} width={pitch + 0.5} height={LANE_H - TOP + 6} fill="var(--down-bg)" />
                      <rect x={-pitch / 2} y={LANE_H - 2} width={pitch + 0.5} height={2} fill="var(--down)" />
                    </>
                  )}
                  {s.marker && <line x1={-pitch / 2} x2={-pitch / 2} y1={TOP - 6} y2={LANE_H} stroke={s.marker === "opened" ? "var(--down)" : "var(--ink)"} strokeWidth="1" />}
                  <rect className="replay-tick" x={-bar / 2} y={LANE_H - 1 - h} width={bar} height={h} rx="1"
                    fill={s.ok ? "var(--chart)" : "var(--down)"} opacity={cursor !== null && cursor !== j ? 0.35 : 1} />
                  {showCounter && (
                    <text x={0} y={TOP - 12} textAnchor="middle" className="font-mono" fontSize="13" fill={s.ok ? "var(--ink-2)" : "var(--down)"}>{s.counter}</text>
                  )}
                </g>
              );
            })}
            <line x1={0} x2={width} y1={LANE_H - 0.5} y2={LANE_H - 0.5} stroke="var(--line-strong)" />
            {/* The oldest checks fade out at the left edge instead of being cut off. */}
            <defs>
              <linearGradient id="replay-fade">
                <stop offset="0" stopColor="var(--canvas)" />
                <stop offset="1" stopColor="var(--canvas)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect x={-1} y={0} width={56} height={LANE_H + 1} fill="url(#replay-fade)" />
            {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={LANE_H} stroke="var(--muted)" strokeDasharray="2 3" />}
          </svg>
        )}
      </div>
      {/* Under the lane: where it starts, then the latest check or the one under the cursor. */}
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-mono text-[13px]" aria-hidden>
        <span className="text-muted">{shown[0] ? clock(shown[0].at) : ""}</span>
        <p className="flex min-h-5 flex-wrap items-baseline justify-end gap-x-3 gap-y-1">
          <span className="text-muted">{cursor !== null ? "At cursor" : "Latest"}</span>
          {read && (
            <>
              <span className="text-ink">{clock(read.at)}</span>
              <span className={read.ok ? "text-ink-2" : "text-down"}>{read.ok ? "passed" : "failed"}</span>
              <span className="text-ink-2">{read.code ? `HTTP ${read.code}` : "no response"}</span>
              <span className="text-ink-2">{read.ms != null ? `${read.ms} ms` : "–"}</span>
              {read.error && <span className="text-down">{read.error}</span>}
            </>
          )}
        </p>
      </div>

      {/* The state machine itself, with the current state lit. */}
      <ol className="mt-8 grid grid-cols-2 gap-px border-y border-line bg-line md:grid-cols-4" aria-label="Incident state machine">
        {PHASES.map((p) => {
          const on = p.id === run.phase;
          const count = p.id === "failing" ? `${on ? run.fails : 0} of ${OPEN_AFTER}` : p.id === "recovering" ? `${on ? run.passes : 0} of ${RESOLVE_AFTER}` : null;
          return (
            <li key={p.id} aria-current={on ? "step" : undefined} className="relative bg-canvas py-4 pr-4 md:pl-4 md:first:pl-0 max-md:even:pl-4">
              <span className={`absolute inset-x-0 -top-px h-px transition-colors duration-300 ${on ? (p.id === "down" || p.id === "failing" ? "bg-down" : "bg-ink") : "bg-transparent"}`} aria-hidden />
              <div className="flex items-center justify-between gap-2 max-sm:flex-col max-sm:items-start max-sm:gap-1">
                <span className={`inline-flex items-center gap-2 font-mono text-[13px] font-medium uppercase tracking-[0.06em] transition-colors duration-300 ${on ? (p.id === "down" ? "text-down" : "text-ink") : "text-muted"}`}>
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={on ? "" : "opacity-40"}>{p.mark}</svg>
                  {p.title}
                </span>
                {count && <span className={`font-mono text-sm ${on ? "text-ink" : "text-muted"}`}>{count}</span>}
              </div>
              <p className={`mt-1.5 text-sm transition-colors duration-300 ${on ? "text-ink-2" : "text-muted"}`}>{p.rule}</p>
            </li>
          );
        })}
      </ol>

      <div className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div>
          <h4 className="caps mb-4">Incident timeline</h4>
          {run.events.length ? (
            <div className="replay-timeline"><Timeline events={run.events} formatAt={(t) => t} /></div>
          ) : (
            <p className="text-[15px] text-muted">
              {run.steps.some((s) => !s.ok) ? "One failure, counted and reset. No incident, no alert." : "No incident yet. Every check is stored as it lands."}
            </p>
          )}
        </div>
        <div>
          <h4 className="caps mb-4">Alerts sent to {CHANNEL}</h4>
          {run.alerts.length ? (
            <div className="flex flex-col gap-6">
              {run.alerts.map((a) => (
                <div key={a.kind} className="replay-alert border-t border-line pt-3">
                  <p className="mb-2 flex items-center justify-between font-mono text-[13px] text-muted">
                    <span>email</span><span>{clock(a.at)}</span>
                  </p>
                  <pre className={`whitespace-pre-wrap break-words font-mono text-sm leading-6 ${a.kind === "created" ? "text-ink" : "text-ink-2"}`}>
                    {a.lines.join("\n")}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[15px] text-muted">Nothing sent. Pulse alerts once per incident, not per failed check.</p>
          )}
        </div>
      </div>
    </div>
  );
}
