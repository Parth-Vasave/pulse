/** One figure in a hairline readout row: label in engraved caps, value in mono. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 bg-canvas py-4 pr-4">
      <dt className="caps truncate">{label}</dt>
      <dd className="mt-1 font-mono text-lg tracking-tight text-ink md:text-xl">{value}</dd>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** A row of Stats ruled top and bottom; columns split by hairlines. */
export function StatRow({ children, cols }: { children: React.ReactNode; cols: string }) {
  return (
    <dl className={`readout grid grid-cols-2 gap-px border-t border-line bg-line ${cols}`}>
      {children}
    </dl>
  );
}
