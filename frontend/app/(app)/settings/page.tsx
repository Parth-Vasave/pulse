"use client";

import { useState } from "react";
import { ExternalIcon, PlusIcon, SendIcon, TrashIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { Badge, Button, Card, CopyButton, ConfirmDialog, ErrorState, Field, FormError, IconButton, LinkButton, PageHeader, SkeletonRows, Toggle, inputClass } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { ApiKey, Channel } from "@/lib/types";

const TYPE_LABEL = { email: "Email", webhook: "Webhook", discord: "Discord" } as const;

function Channels() {
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

function ApiKeys() {
  const toast = useToast();
  const { data, error, reload } = useApi<ApiKey[]>("/api-keys");
  const [created, setCreated] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const f = new FormData(form); setErr(null); setBusy(true);
    try { const k = await api<{ key: string }>("/api-keys", { method: "POST", json: { name: f.get("name") } }); setCreated(k.key); form.reset(); reload(); }
    catch (x) { setErr(describeError(x)); }
    setBusy(false);
  }
  async function revoke() {
    if (!revoking) return;
    try { await api(`/api-keys/${revoking.id}`, { method: "DELETE" }); toast.success(`Revoked ${revoking.name}`); reload(); }
    catch (x) { toast.error(describeError(x)); }
    setRevoking(null);
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">API keys</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Use a key as <code className="rounded bg-paused-bg px-1">Authorization: Bearer &lt;key&gt;</code> to call the API from scripts.</p>
      {created && (
        <div role="status" className="mb-4 rounded-md border border-up/40 bg-up-bg p-3 text-sm">
          <p className="font-medium text-up">Copy your new key now. It won’t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-surface p-2 text-ink">{created}</code>
            <CopyButton text={created} label="Copy key" />
          </div>
        </div>
      )}
      <FormError message={err} />
      {error && <ErrorState message="Could not load API keys." onRetry={reload} />}
      <ul className="mb-4 divide-y divide-line rounded-md border border-line">
        {data?.length === 0 && <li className="p-4 text-sm text-muted">No API keys yet.</li>}
        {data?.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div><span className="font-medium">{k.name}</span> <span className="text-muted">· {k.prefix}… · {k.revoked_at ? "Revoked" : k.last_used_at ? `Used ${timeAgo(k.last_used_at)}` : "Never used"}</span></div>
            {!k.revoked_at && <Button size="sm" variant="danger-ghost" onClick={() => setRevoking(k)}>Revoke</Button>}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <Field label="Key name" htmlFor="key-name"><input id="key-name" name="name" required className={inputClass} placeholder="CI pipeline" /></Field>
        <Button type="submit" variant="primary" loading={busy} icon={<PlusIcon />}>Create key</Button>
      </form>
      <ConfirmDialog open={!!revoking} title={`Revoke ${revoking?.name ?? "key"}?`} body="Anything using this key will immediately lose access." confirmLabel="Revoke key" onConfirm={revoke} onCancel={() => setRevoking(null)} />
    </Card>
  );
}

function StatusPage() {
  const toast = useToast();
  const { data, reload } = useApi<{ enabled: boolean; slug: string | null }>("/status-page");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setError(null); setBusy(true);
    try { await api("/status-page", { method: "PUT", json: { enabled: enabled ?? data?.enabled ?? false, slug: (f.get("slug") as string) || null } }); toast.success("Status page saved."); reload(); setEnabled(null); }
    catch (x) { setError(describeError(x)); }
    setBusy(false);
  }
  if (!data) return <Card className="p-6"><SkeletonRows rows={2} /></Card>;
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Public status page</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Share the health of selected monitors without exposing their configuration. Choose monitors in each monitor’s settings.</p>
      <form key={`${data.enabled}-${data.slug}`} onSubmit={save} className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="flex items-center gap-3 text-sm">
          <Toggle checked={enabled ?? data.enabled} onChange={setEnabled} label="Make the status page public" />
          <span>Make the status page public</span>
        </div>
        <Field label="Page address" htmlFor="slug" hint="Lowercase letters, numbers and hyphens.">
          <input id="slug" name="slug" defaultValue={data.slug ?? ""} className={inputClass} placeholder="acme" />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" loading={busy}>Save</Button>
          {data.enabled && data.slug && <LinkButton href={`/status/${data.slug}`} target="_blank" rel="noreferrer" icon={<ExternalIcon />}>Open status page</LinkButton>}
        </div>
      </form>
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6"><Channels /><StatusPage /><ApiKeys /></div>
    </div>
  );
}
