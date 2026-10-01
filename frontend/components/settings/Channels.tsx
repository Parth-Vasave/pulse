"use client";

import { useState } from "react";
import { ExternalIcon, PlusIcon, SendIcon, TrashIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { Badge, Button, Card, ConfirmDialog, CopyButton, ErrorState, Field, FormError, IconButton, LinkButton, SkeletonRows, Toggle, inputClass } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { ApiKey, Channel } from "@/lib/types";

const TYPE_LABEL = { email: "Email", webhook: "Webhook", discord: "Discord" } as const;

export function Channels() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Channel[]>("/channels");
  const [type, setType] = useState<Channel["type"]>("email");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Channel | null>(null);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setFormError(null);
    try {
      await api("/channels", { method: "POST", json: { type, name: f.get("name"), ...(type === "email" ? { address: f.get("target") } : { url: f.get("target") }) } });
      form.reset(); reload(); toast.success(`Added ${f.get("name")}. Use "Send test" to check it works.`);
    } catch (err) { setFormError(describeError(err)); }
    setBusy(false);
  }
  async function test(c: Channel) {
    setTesting(c.id);
    try { await api(`/channels/${c.id}/test`, { method: "POST" }); toast.success(`Test notification sent to ${c.name}.`); }
    catch (err) { toast.error(describeError(err)); }
    setTesting(null);
  }
  async function toggle(c: Channel, enabled: boolean) {
    try { await api(`/channels/${c.id}`, { method: "PATCH", json: { enabled } }); toast.success(`${enabled ? "Enabled" : "Disabled"} ${c.name}`); reload(); }
    catch (err) { toast.error(describeError(err)); }
  }
  async function remove() {
    if (!removing) return;
    try { await api(`/channels/${removing.id}`, { method: "DELETE" }); toast.success(`Deleted ${removing.name}`); reload(); }
    catch (err) { toast.error(describeError(err)); }
    setRemoving(null);
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Notification channels</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Where Pulse sends a message when an incident opens or resolves.</p>
      {loading && !data ? <SkeletonRows rows={2} /> : error && !data ? <ErrorState message="Could not load channels." onRetry={reload} /> : (
        <ul className="mb-6 divide-y divide-line rounded-md border border-line">
          {data?.length === 0 && <li className="p-4 text-sm text-muted">No channels yet. Add one below to get alerted.</li>}
          {data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="font-medium">{c.name}</span><Badge>{TYPE_LABEL[c.type]}</Badge>{!c.enabled && <Badge tone="warn">Disabled</Badge>}</div>
                <div className="truncate text-xs text-muted">{c.target}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" icon={<SendIcon />} loading={testing === c.id} onClick={() => test(c)}>Send test</Button>
                <Toggle checked={c.enabled} onChange={(v) => toggle(c, v)} label={`${c.enabled ? "Disable" : "Enable"} ${c.name}`} />
                <IconButton label={`Delete ${c.name}`} variant="danger-ghost" onClick={() => setRemoving(c)}><TrashIcon /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-3">
        <FormError message={formError} />
        <div className="grid gap-3 sm:grid-cols-[9rem_1fr_1.4fr_auto] sm:items-end">
          <Field label="Type" htmlFor="ch-type"><select id="ch-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as Channel["type"])}><option value="email">Email</option><option value="webhook">Webhook</option><option value="discord">Discord</option></select></Field>
          <Field label="Name" htmlFor="ch-name"><input id="ch-name" name="name" required className={inputClass} placeholder="On-call" /></Field>
          <Field label={type === "email" ? "Email address" : "Webhook URL"} htmlFor="ch-target"><input id="ch-target" name="target" required type={type === "email" ? "email" : "url"} className={inputClass} placeholder={type === "email" ? "oncall@example.com" : "https://…"} /></Field>
          <Button type="submit" variant="primary" loading={busy} icon={<PlusIcon />}>Add channel</Button>
        </div>
      </form>
      <ConfirmDialog open={!!removing} title={`Delete ${removing?.name ?? "channel"}?`} body="You will stop receiving alerts here. Past notification history is kept." confirmLabel="Delete channel" onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}
