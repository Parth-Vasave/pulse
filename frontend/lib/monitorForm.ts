import type { Assertion, Monitor } from "@/lib/types";

export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 1) throw new Error(`Header "${line}" must look like Name: value`);
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return headers;
}

export function headersToText(h: Record<string, string>): string {
  return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n");
}

export interface FormValues {
  name: string; url: string; method: string; headers: string; body: string;
  expected_status_code: string; timeout_seconds: string; interval_seconds: string;
  response_time_threshold_ms: string; failure_threshold: string; recovery_threshold: string;
  check_retries: string; show_on_status_page: boolean; assertions: Assertion[];
}

export const DEFAULTS: FormValues = {
  name: "", url: "https://", method: "GET", headers: "", body: "", expected_status_code: "200",
  timeout_seconds: "10", interval_seconds: "60", response_time_threshold_ms: "", failure_threshold: "3",
  recovery_threshold: "2", check_retries: "0", show_on_status_page: false, assertions: [],
};

export function fromMonitor(m: Monitor): FormValues {
  return {
    name: m.name, url: m.url, method: m.method, headers: headersToText(m.headers), body: m.body ?? "",
    expected_status_code: String(m.expected_status_code), timeout_seconds: String(m.timeout_seconds),
    interval_seconds: String(m.interval_seconds), response_time_threshold_ms: m.response_time_threshold_ms?.toString() ?? "",
    failure_threshold: String(m.failure_threshold), recovery_threshold: String(m.recovery_threshold),
    check_retries: String(m.check_retries), show_on_status_page: m.show_on_status_page, assertions: m.assertions,
  };
}

export function toPayload(v: FormValues) {
  return {
    name: v.name.trim(), url: v.url.trim(), method: v.method, headers: parseHeaders(v.headers),
    body: v.body.trim() ? v.body : null, expected_status_code: Number(v.expected_status_code),
    timeout_seconds: Number(v.timeout_seconds), interval_seconds: Number(v.interval_seconds),
    response_time_threshold_ms: v.response_time_threshold_ms ? Number(v.response_time_threshold_ms) : null,
    failure_threshold: Number(v.failure_threshold), recovery_threshold: Number(v.recovery_threshold),
    check_retries: Number(v.check_retries), show_on_status_page: v.show_on_status_page, assertions: v.assertions,
  };
}
