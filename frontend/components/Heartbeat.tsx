/** Last N check outcomes as a strip: tall bar = passed, short bar = failed (shape + color). */
export function Heartbeat({ results, count = 40 }: { results: boolean[] | undefined; count?: number }) {
  const padded = [...Array(Math.max(0, count - (results?.length ?? 0))).fill(null), ...(results ?? []).slice(-count)];
  const failed = (results ?? []).filter((r) => !r).length;
  const label = results?.length
    ? `Last ${results.length} checks: ${results.length - failed} passed, ${failed} failed`
    : "No checks yet";
  return (
    <svg role="img" aria-label={label} width={count * 5} height="20" className="block">
      <title>{label}</title>
      {padded.map((r, i) => (
        <rect key={i} x={i * 5} y={r === false ? 8 : 0} width="3" height={r === false ? 12 : 20} rx="1.5"
          fill={r === null ? "var(--line)" : r ? "var(--up)" : "var(--down)"} opacity={r === null ? 0.6 : 1} />
      ))}
    </svg>
  );
}
