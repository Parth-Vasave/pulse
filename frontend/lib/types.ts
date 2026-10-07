export type DisplayStatus = "up" | "down" | "paused" | "unknown";

export interface Monitor {
  id: number;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  expected_status_code: number;
  timeout_seconds: number;
  interval_seconds: number;
  response_time_threshold_ms: number | null;
  failure_threshold: number;
  recovery_threshold: number;
  check_retries: number;
  assertions: Assertion[];
  enabled: boolean;
  show_on_status_page: boolean;
  status: string;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  uptime_24h: number | null;
  display_status: DisplayStatus;
}

export type Assertion =
  | { type: "body_contains" | "body_not_contains"; value: string }
  | { type: "json_field"; path: string; operator: "eq" | "ne" | "contains" | "exists"; value?: string | number | boolean | null };

export interface CheckResult {
  id: number;
  checked_at: string;
  success: boolean;
  status_code: number | null;
  response_time_ms: number | null;
  check_duration_ms: number | null;
  error_type: string | null;
  error_message: string | null;
}

export interface Summary {
  total_checks: number;
  successful_checks: number;
  uptime_percentage: number | null;
  downtime_seconds: number;
  covered_seconds: number;
  avg_response_time_ms: number | null;
  p50_response_time_ms: number | null;
  p95_response_time_ms: number | null;
  p99_response_time_ms: number | null;
}

export interface SeriesPoint {
  timestamp: string;
  checks: number;
  availability: number;
  error_rate: number;
  errors: Record<string, number>;
  avg_response_time_ms: number | null;
  max_response_time_ms: number | null;
}

export interface MonitorStats {
  range: TimeRange;
  summary: Summary;
  uptime: Record<"24h" | "7d" | "30d", number | null>;
  series: SeriesPoint[];
}

export type TimeRange = "1h" | "24h" | "7d" | "30d";

export interface Incident {
  id: number;
  monitor_id: number;
  monitor_name: string;
  started_at: string;
  resolved_at: string | null;
  status: "open" | "resolved";
  failure_count: number;
  recovery_count: number;
  reason: string;
  duration_seconds: number;
}

export interface IncidentEvent {
  occurred_at: string;
  event_type: string;
  message: string;
}

export interface IncidentDetail extends Incident {
  events: IncidentEvent[];
}

export interface DashboardSummary {
  total_monitors: number;
  healthy_monitors: number;
  down_monitors: number;
  paused_monitors: number;
  active_incidents: number;
  overall_uptime_24h: number | null;
}

export interface Channel {
  id: number;
  type: "email" | "webhook" | "discord";
  name: string;
  enabled: boolean;
  target: string;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface PublicStatus {
  overall_status: "operational" | "degraded" | "outage" | "unknown";
  components: { name: string; status: string; uptime_30d: number | null }[];
  incidents: { monitor: string; status: string; started_at: string; resolved_at: string | null }[];
}

/** One recent check as the dashboard plot draws it. */
export interface TracePoint { ok: boolean; ms: number | null; at: string }
