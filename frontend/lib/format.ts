export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatPercent(v: number | null | undefined, digits = 2): string {
  return v == null ? "No data" : `${Number(v.toFixed(digits))}%`;
}

export function formatMs(v: number | null | undefined): string {
  if (v == null) return "–";
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "Never";
  const diff = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (diff < 5) return "Just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatTime(iso: string, withDate = false): string {
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return withDate ? `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}` : t;
}

export const ERROR_LABELS: Record<string, string> = {
  timeout: "Timed out",
  dns_failure: "DNS lookup failed",
  connect_failure: "Connection failed",
  invalid_response: "Invalid response",
  unexpected_status: "Unexpected status",
  http_error: "HTTP error",
  assertion_failed: "Assertion failed",
  slow_response: "Too slow",
  blocked_target: "Target blocked",
};
