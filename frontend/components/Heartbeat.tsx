/** Last N check outcomes as ticks: a short neutral tick passed, a full-height red tick failed (shape + color). */
export function Heartbeat({ results, count = 40 }: { results: boolean[] | undefined; count?: number }) {
  const padded = [...Array(Math.max(0, count - (results?.length ?? 0))).fill(null), ...(results ?? []).slice(-count)];
  const failed = (results ?? []).filter((r) => !r).length;
  const label = results?.length
    ? `Last ${results.length} checks: ${results.length - failed} passed, ${failed} failed`
    : "No checks yet";
  return (
    <svg role="img" aria-label={label} width={count * 4} height="18" className="block">
      <title>{label}</title>
      {padded.map((r, i) => (
        <rect key={i} x={i * 4} y={r === false ? 0 : r ? 8 : 16} width="2" height={r === false ? 18 : r ? 10 : 2} rx="1"
          fill={r === null ? "var(--line-strong)" : r ? "var(--faint)" : "var(--down)"} />
      ))}
    </svg>
  );
}
