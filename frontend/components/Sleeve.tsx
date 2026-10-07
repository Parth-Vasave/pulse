import { LogoMark } from "@/components/Logo";

// Deterministic noise so server and client render the same emblem.
function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const LINES = 30, POINTS = 120, W = 400, GAP = 10, AMP = 58;

function ridges() {
  const r = rand(251);
  return Array.from({ length: LINES }, (_, row) => {
    const base = 70 + row * GAP;
    // A few smooth bumps clustered at the centre, plus fine jitter: flat at the edges, alive in the middle.
    const bumps = Array.from({ length: 3 + Math.floor(r() * 3) }, () => ({ at: W / 2 + (r() - 0.5) * 120, w: 6 + r() * 14, h: 0.25 + r() * 0.75 }));
    const pts = Array.from({ length: POINTS }, (_, i) => {
      const x = (i / (POINTS - 1)) * W;
      const envelope = Math.exp(-((x - W / 2) ** 2) / (2 * 70 ** 2));
      const peak = bumps.reduce((sum, b) => sum + b.h * Math.exp(-((x - b.at) ** 2) / (2 * b.w ** 2)), 0);
      const y = base - (r() * 0.05 + envelope * (peak + r() * 0.08)) * AMP;
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join("");
    return { line: pts, fill: `${pts}L${W} ${base + 4}L0 ${base + 4}Z` };
  });
}

const RIDGES = ridges();

/** The brand emblem for the sign-in pages: a pressed sleeve with a ridgeline of pulses. Decorative, not data. */
export function Sleeve() {
  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-[#0a0a0a] p-10 text-[#ededed]">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em]"><LogoMark />Pulse</span>
      </div>
      <svg viewBox={`0 0 ${W} ${70 + LINES * GAP + 10}`} className="mx-auto w-[min(70%,30rem)]" aria-hidden>
        {RIDGES.map((d, i) => (
          <g key={i}>
            <path d={d.fill} fill="#0a0a0a" />
            <path d={d.line} fill="none" stroke="#ededed" strokeWidth="1.1" strokeLinejoin="round" />
          </g>
        ))}
      </svg>
      <p className="max-w-[18rem] text-[15px] leading-5 text-[#8f8f8f]">Every check is a pulse. Pulse keeps each one, and opens an incident when they stop coming back healthy.</p>
    </div>
  );
}
