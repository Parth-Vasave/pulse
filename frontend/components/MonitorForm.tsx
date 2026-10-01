"use client";

import { useState } from "react";
import { describeError } from "@/lib/api";
import { DEFAULTS, toPayload, type FormValues } from "@/lib/monitorForm";
import type { Assertion } from "@/lib/types";
import { Button, Card, Field, FormError, Toggle, inputClass, textareaClass } from "@/components/ui";
import { PlusIcon, TrashIcon } from "@/components/icons";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function MonitorForm({ initial = DEFAULTS, submitLabel, onSubmit, onCancel }: {
  initial?: FormValues; submitLabel: string;
  onSubmit: (payload: ReturnType<typeof toPayload>) => Promise<void>; onCancel: () => void;
}) {
  const [v, setV] = useState<FormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const text = (k: keyof FormValues) => ({ id: k, value: v[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value as never), className: inputClass });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onSubmit(toPayload(v)); } catch (err) { setError(err instanceof Error && !("status" in err) ? err.message : describeError(err)); setBusy(false); }
  }

  const setAssertion = (i: number, a: Assertion) => set("assertions", v.assertions.map((x, j) => (j === i ? a : x)));

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
      <FormError message={error} />
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-semibold">Request</h2>
        <Field label="Name" htmlFor="name"><input {...text("name")} required maxLength={120} placeholder="Production API" /></Field>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label="Method" htmlFor="method"><select {...text("method")}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="URL" htmlFor="url" hint="Public http(s) addresses only. Private and internal addresses are blocked."><input {...text("url")} type="url" required placeholder="https://api.example.com/health" /></Field>
        </div>
        <Field label="Headers" htmlFor="headers" hint="One per line, as Name: value."><textarea {...text("headers")} className={textareaClass} rows={3} placeholder="Authorization: Bearer …" /></Field>
        {v.method !== "GET" && <Field label="Body" htmlFor="body" hint="Sent as-is. Add a Content-Type header for JSON."><textarea {...text("body")} className={textareaClass} rows={4} /></Field>}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-semibold">What counts as healthy</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Expected status code" htmlFor="expected_status_code"><input {...text("expected_status_code")} type="number" min={100} max={599} required /></Field>
          <Field label="Timeout (seconds)" htmlFor="timeout_seconds" hint="1–30"><input {...text("timeout_seconds")} type="number" min={1} max={30} required /></Field>
          <Field label="Slow after (ms)" htmlFor="response_time_threshold_ms" hint="Optional. Slower responses count as failures."><input {...text("response_time_threshold_ms")} type="number" min={1} max={60000} /></Field>
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Response checks <span className="font-normal text-muted">(optional)</span></legend>
          {v.assertions.map((a, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-line p-3">
              <Field label="Type" htmlFor={`a-type-${i}`}>
                <select id={`a-type-${i}`} className={inputClass} value={a.type}
                  onChange={(e) => setAssertion(i, e.target.value === "json_field" ? { type: "json_field", path: "", operator: "eq", value: "" } : { type: e.target.value as "body_contains", value: "" })}>
                  <option value="body_contains">Body contains</option>
                  <option value="body_not_contains">Body does not contain</option>
                  <option value="json_field">JSON field</option>
                </select>
              </Field>
              {a.type === "json_field" ? (
                <>
                  <Field label="Path" htmlFor={`a-path-${i}`}><input id={`a-path-${i}`} className={inputClass} required value={a.path} placeholder="status" onChange={(e) => setAssertion(i, { ...a, path: e.target.value })} /></Field>
                  <Field label="Operator" htmlFor={`a-op-${i}`}>
                    <select id={`a-op-${i}`} className={inputClass} value={a.operator} onChange={(e) => setAssertion(i, { ...a, operator: e.target.value as typeof a.operator })}>
                      <option value="eq">equals</option><option value="ne">does not equal</option><option value="contains">contains</option><option value="exists">exists</option>
                    </select>
                  </Field>
                  {a.operator !== "exists" && <Field label="Value" htmlFor={`a-val-${i}`}><input id={`a-val-${i}`} className={inputClass} required value={String(a.value ?? "")} placeholder="healthy" onChange={(e) => setAssertion(i, { ...a, value: e.target.value })} /></Field>}
                </>
              ) : (
                <Field label="Text" htmlFor={`a-val-${i}`}><input id={`a-val-${i}`} className={inputClass} required value={a.value} placeholder='"database": "connected"' onChange={(e) => setAssertion(i, { ...a, value: e.target.value })} /></Field>
              )}
              <Button variant="danger-ghost" icon={<TrashIcon />} onClick={() => set("assertions", v.assertions.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <div><Button size="sm" icon={<PlusIcon />} onClick={() => set("assertions", [...v.assertions, { type: "body_contains", value: "" }])}>Add response check</Button></div>
        </fieldset>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-semibold">Schedule and alerting</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Check every (seconds)" htmlFor="interval_seconds" hint="30 to 86400"><input {...text("interval_seconds")} type="number" min={30} max={86400} required /></Field>
          <Field label="Retry on network errors" htmlFor="check_retries" hint="Extra immediate attempts after a timeout or connection failure (0–3)."><input {...text("check_retries")} type="number" min={0} max={3} /></Field>
          <Field label="Open an incident after" htmlFor="failure_threshold" hint="Consecutive failed checks (1–10)."><input {...text("failure_threshold")} type="number" min={1} max={10} required /></Field>
          <Field label="Resolve after" htmlFor="recovery_threshold" hint="Consecutive passing checks (1–10)."><input {...text("recovery_threshold")} type="number" min={1} max={10} required /></Field>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Toggle checked={v.show_on_status_page} onChange={(x) => set("show_on_status_page", x)} label="Show this monitor on my public status page" />
          <span>Show this monitor on my public status page</span>
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-canvas/90 px-4 py-3 backdrop-blur">
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}
