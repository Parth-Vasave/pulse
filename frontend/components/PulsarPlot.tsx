"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { formatMs } from "@/lib/format";
import type { Monitor, TracePoint } from "@/lib/types";

const MAX_ROWS = 20;
const WINDOW = 60 * 60 * 1000; // the plot always shows the last hour
const LABEL = 22; // label line above each lane on narrow screens
const GAP = 8; // air between lanes
const PAD = 5; // keeps the line and the hover dot off the lane edges
const TICKS = [60, 45, 30, 15];
const TICKS_COMPACT = [60, 30];

/** About half the viewport, split between lanes. Lanes never overlap, so every line stays readable on its own. */
function laneHeight(rows: number, viewport: number, compact: boolean) {
  const room = viewport * 0.45 - 40;
  return Math.round(Math.min(56, Math.max(compact ? 32 : 28, room / rows - (compact ? LABEL : 0) - GAP)));
}

type Point = { ok: boolean; ms: number | null; t: number };

/** Points inside the window, plus the last one before it so the line enters from the left edge. */
function visible(trace: TracePoint[], start: number): Point[] {
  const pts = trace.map((p) => ({ ok: p.ok, ms: p.ms, t: Date.parse(p.at) }));
  const first = pts.findIndex((p) => p.t >= start);
  return first === -1 ? [] : pts.slice(Math.max(0, first - 1));
}

/**
 * One log scale shared by every lane and fitted to the data (at least one decade tall): the same height means the
 * same latency on every monitor. Gridlines sit at the whole decades inside it (10 ms, 100 ms, 1 s ...).
 */
function logScale(lanes: Point[][]) {
  let min = Infinity;
  let max = -Infinity;
  for (const lane of lanes) for (const p of lane) if (p.ms != null) { min = Math.min(min, p.ms); max = Math.max(max, p.ms); }
  if (!Number.isFinite(min)) return { lo: 1, hi: 3, grid: [1, 2, 3] };
  let lo = Math.log10(Math.max(1, min) * 0.8);
  let hi = Math.log10(Math.max(1, max) * 1.25);
  if (hi - lo < 1) { const mid = (lo + hi) / 2; lo = mid - 0.5; hi = mid + 0.5; }
  const grid: number[] = [];
  for (let d = Math.ceil(lo); d <= hi; d++) grid.push(d);
  return { lo, hi, grid };
}

/**
 * The line breaks wherever a check has no response time or the monitor skipped more than a couple of checks
 * (paused, or the worker was down), so a gap is never drawn as a straight line. Each failed check paints a red
 * band from its time to the next check's, which is how long the monitor was known to be failing.
 */
function shapes(pts: Point[], interval: number, now: number, x: (t: number) => number, y: (ms: number) => number) {
  let line = "";
  const dots: [number, number][] = [];
  const bands: [number, number][] = [];
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length === 1) dots.push(run[0]);
    else if (run.length) line += run.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
    run = [];
  };
  pts.forEach((p, i) => {
    const next = pts[i + 1];
    if (p.ms == null) flush();
    else {
      const prev = pts[i - 1];
      if (prev && p.t - prev.t > interval * 2.5) flush();
      run.push([x(p.t), y(p.ms)]);
    }
    if (!p.ok) {
      const end = Math.min(next ? next.t : now, p.t + interval * 1.5);
      bands.push([x(p.t), Math.max(2, x(end) - x(p.t))]);
    }
  });
  flush();
  return { line, dots, bands };
}

/** The check closest to time t, if one ran within an interval of it. */
function nearest(pts: Point[], t: number, interval: number) {
  let best: Point | undefined;
  for (const p of pts) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best && Math.abs(best.t - t) <= interval ? best : undefined;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { setWidth(Math.round(e.contentRect.width)); setViewport(window.innerHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width, viewport] as const;
}

/** The current time, ticking every few seconds so the window keeps sliding between data refreshes. */
function useNow(every = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Every monitor's response time over the last hour, one lane each, on one shared log scale with real time across.
 * Pointing anywhere on the plot drops a crosshair through every lane and the right-hand column reads out each
 * monitor's check at that moment. Pointing at or focusing a lane (or its table row) highlights it.
 */
export function PulsarPlot({ monitors, traces, active, onActive }: {
  monitors: Monitor[]; traces: Record<string, TracePoint[]> | undefined;
  active: number | null; onActive: (id: number | null) => void;
}) {
  const [figRef, figWidth, viewport] = useSize<HTMLElement>();
  const [cursor, setCursor] = useState<number | null>(null);
  const tick = useNow();
  const shown = monitors.slice(0, MAX_ROWS);
  // A check that lands between ticks still sits at the right edge rather than past it.
  const newest = Math.max(0, ...shown.map((m) => Date.parse(traces?.[m.id]?.at(-1)?.at ?? "") || 0));
  const now = Math.max(tick, newest);
  const start = now - WINDOW;
  const lanes = shown.map((m) => visible(traces?.[m.id] ?? [], start));
  const { lo, hi, grid } = logScale(lanes);
  const hidden = monitors.length - shown.length;
  // Narrow screens stack name and latency above a full-width lane instead of squeezing the lane between them.
  const compact = figWidth > 0 && figWidth < 600;
  const lane = laneHeight(shown.length, compact ? Math.min(viewport, 760) : viewport, compact);
  const width = compact ? figWidth : Math.max(0, figWidth - 176 - 88 - 40);
  const cols = compact ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[11rem_minmax(0,1fr)_5.5rem] gap-x-5";
  const x = (t: number) => ((t - start) / WINDOW) * (width - 4);
  const y = (ms: number) => lane - PAD - ((Math.log10(Math.max(1, ms)) - lo) / (hi - lo)) * (lane - 2 * PAD);

  function track(e: PointerEvent<HTMLElement>) {
    const svg = e.currentTarget.querySelector("svg");
    if (!svg || !width) return;
    const px = e.clientX - svg.getBoundingClientRect().left;
    setCursor(px < 0 || px > width ? null : start + (Math.min(px, width - 4) / (width - 4)) * WINDOW);
  }

  return (
    <figure ref={figRef} aria-label="Response time of every monitor over the last hour" className="select-none">
      <div onPointerLeave={() => { onActive(null); setCursor(null); }}>
        {shown.map((m, i) => {
          const pts = lanes[i];
          const interval = m.interval_seconds * 1000;
          const { line, dots, bands } = width ? shapes(pts, interval, now, x, y) : { line: "", dots: [], bands: [] };
          const down = m.display_status === "down";
          const paused = m.display_status === "paused";
          const lit = active === m.id;
          const all = traces?.[m.id] ?? [];
          const latest = all[all.length - 1];
          const hit = cursor != null ? nearest(pts, cursor, interval) : undefined;
          const value = cursor != null
            ? (hit ? (hit.ok ? formatMs(hit.ms) : "failed") : "–")
            : down ? "down" : paused ? "paused" : formatMs(latest?.ms);
          const red = cursor != null ? hit?.ok === false : down;
          const name = (
            <span className={`truncate text-[15px] transition-colors duration-200 ${compact ? "text-left" : "text-right"} ${lit ? "text-ink" : down ? "text-down" : "text-muted"}`}>
              {m.name}
            </span>
          );
          const readout = (
            <span className={`text-right font-mono text-sm tabular-nums transition-colors duration-200 ${red ? "text-down" : lit || cursor != null ? "text-ink" : "text-muted"}`}>
              {value}
            </span>
          );
          return (
            <Link key={m.id} href={`/monitors/${m.id}`}
              onPointerEnter={(e) => { if (e.pointerType === "mouse") onActive(m.id); }}
              onPointerMove={track}
              onFocus={() => onActive(m.id)} onBlur={() => onActive(null)}
              aria-label={`${m.name}: ${down ? "down" : paused ? "paused" : `latest response ${formatMs(latest?.ms)}`}. Open monitor.`}
              className={`grid items-center rounded-sm transition-colors duration-150 focus-visible:outline-offset-4 ${cols} ${lit ? "bg-raised/60" : ""}`}
              style={{ height: lane + GAP + (compact ? LABEL : 0) }}>
              {compact ? <span className="contents">{name}{readout}</span> : name}
              <svg key={pts.length ? "data" : "empty"} width="100%" height={lane}
                className={`pointer-events-none ${pts.length ? "trace-reveal" : ""} ${compact ? "col-span-2" : ""}`}
                style={{ animationDelay: `${i * 45}ms` }} aria-hidden>
                {bands.map(([bx, bw], k) => (
                  <g key={k} fill="var(--down)">
                    <rect x={bx} y={0} width={bw} height={lane} fill="var(--down-bg)" />
                    <rect x={bx} y={lane - 2} width={bw} height={2} />
                  </g>
                ))}
                <line x1="0" x2={width} y1={lane - 0.5} y2={lane - 0.5} stroke="var(--line-strong)" />
                {grid.map((d) => (
                  <line key={d} x1="0" x2={width} y1={Math.round(y(10 ** d)) + 0.5} y2={Math.round(y(10 ** d)) + 0.5}
                    stroke="var(--line-strong)" strokeDasharray="2 3" />
                ))}
                {pts.length === 0 || !width ? null : (
                  <>
                    <path d={line} fill="none" stroke={paused ? "var(--faint)" : "var(--chart)"} strokeWidth={lit ? 2 : 1.5}
                      strokeLinejoin="round" strokeLinecap="round" className="transition-[stroke-width] duration-200" />
                    {dots.map(([dx, dy], k) => <circle key={k} cx={dx} cy={dy} r="1.75" fill={paused ? "var(--faint)" : "var(--chart)"} />)}
                  </>
                )}
                {cursor != null && width > 0 && (
                  <>
                    <line x1={x(cursor)} x2={x(cursor)} y1="0" y2={lane} stroke="var(--muted)" strokeOpacity="0.5" />
                    {hit?.ms != null && (
                      <circle cx={x(hit.t)} cy={y(hit.ms)} r="3" fill={hit.ok ? "var(--chart)" : "var(--down)"} stroke="var(--canvas)" strokeWidth="2" />
                    )}
                  </>
                )}
              </svg>
              {!compact && readout}
            </Link>
          );
        })}

        <div className={`mt-1 grid border-t border-line pt-2 ${compact ? "grid-cols-1" : cols}`} aria-hidden>
          {!compact && <span />}
          <div className="caps relative h-[18px]">
            {(compact ? TICKS_COMPACT : TICKS).map((min, k) => (
              <span key={min} className={`absolute ${k ? "-translate-x-1/2" : ""} ${cursor != null ? "opacity-30" : ""}`}
                style={{ left: `${((WINDOW - min * 60000) / WINDOW) * 100}%` }}>{min}m ago</span>
            ))}
            <span className={`absolute right-0 ${cursor != null ? "opacity-30" : ""}`}>Now</span>
            {cursor != null && width > 0 && (
              <span className="absolute -translate-x-1/2 bg-canvas px-1.5 text-ink" style={{ left: Math.min(Math.max(x(cursor), 28), width - 28) }}>
                {clock(cursor)}
              </span>
            )}
          </div>
          {!compact && <span className="caps text-right">{cursor != null ? "At cursor" : "Latest"}</span>}
        </div>
      </div>
      {hidden > 0 && <p className="mt-3 text-sm text-muted">Showing the {MAX_ROWS} most urgent monitors. All {monitors.length} are in the table below.</p>}
    </figure>
  );
}
