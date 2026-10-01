"use client";

import { useState } from "react";
import { Button, Card, ConfirmDialog, ErrorState, Field, FormError, PageHeader, Spinner, inputClass } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { ApiKey, Channel } from "@/lib/types";

const TYPE_LABEL = { email: "Email", webhook: "Webhook", discord: "Discord" } as const;

function Channels() {
  const { data, error, loading, reload } = useApi<Channel[]>("/channels");
  const [type, setType] = useState<Channel["type"]>("email");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Channel | null>(null);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    setBusy(true); setMsg(null);
    try {
      await api("/channels", { method: "POST", json: { type, name: f.get("name"), ...(type === "email" ? { address: f.get("target") } : { url: f.get("target") }) } });
      form.reset(); reload();
    } catch (err) { setMsg({ ok: false, text: describeError(err) }); }
    setBusy(false);
  }
  async function test(c: Channel) {
    setMsg(null);
    try { await api(`/channels/${c.id}/test`, { method: "POST" }); setMsg({ ok: true, text: `Test notification sent to ${c.name}.` }); }
    catch (err) { setMsg({ ok: false, text: describeError(err) }); }
  }
  async function toggle(c: Channel) { await api(`/channels/${c.id}`, { method: "PATCH", json: { enabled: !c.enabled } }); reload(); }
  async function remove() {
    if (!removing) return;
    await api(`/channels/${removing.id}`, { method: "DELETE" }); setRemoving(null); reload();
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Notification channels</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Where Pulse sends a message when an incident opens or resolves.</p>
      {msg && (msg.ok ? <p role="status" className="mb-3 rounded-md bg-up-bg px-3 py-2 text-sm text-up">{msg.text}</p> : <div className="mb-3"><FormError message={msg.text} /></div>)}
      {loading && !data ? <Spinner /> : error ? <ErrorState message="Could not load channels." onRetry={reload} /> : (
        <ul className="mb-6 divide-y divide-line rounded-md border border-line">
          {data?.length === 0 && <li className="p-4 text-sm text-muted">No channels yet. Add one below to get alerted.</li>}
          {data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div><span className="font-medium">{c.name}</span> <span className="text-muted">· {TYPE_LABEL[c.type]} · {c.target}</span>{!c.enabled && <span className="ml-2 rounded bg-paused-bg px-1.5 py-0.5 text-xs text-paused">Disabled</span>}</div>
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => test(c)}>Send test</Button>
                <Button variant="ghost" onClick={() => toggle(c)}>{c.enabled ? "Disable" : "Enable"}</Button>
                <Button variant="ghost" className="text-down" onClick={() => setRemoving(c)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-[9rem_1fr_1.4fr_auto] sm:items-end">
        <Field label="Type" htmlFor="ch-type"><select id="ch-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as Channel["type"])}><option value="email">Email</option><option value="webhook">Webhook</option><option value="discord">Discord</option></select></Field>
        <Field label="Name" htmlFor="ch-name"><input id="ch-name" name="name" required className={inputClass} placeholder="On-call" /></Field>
        <Field label={type === "email" ? "Email address" : "Webhook URL"} htmlFor="ch-target"><input id="ch-target" name="target" required type={type === "email" ? "email" : "url"} className={inputClass} placeholder={type === "email" ? "oncall@example.com" : "https://…"} /></Field>
        <Button type="submit" variant="primary" disabled={busy}>Add channel</Button>
      </form>
      <ConfirmDialog open={!!removing} title={`Delete ${removing?.name ?? "channel"}?`} body="You will stop receiving alerts here. Past notification history is kept." confirmLabel="Delete channel" onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

function ApiKeys() {
  const { data, error, reload } = useApi<ApiKey[]>("/api-keys");
  const [created, setCreated] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const f = new FormData(form); setErr(null);
    try { const k = await api<{ key: string }>("/api-keys", { method: "POST", json: { name: f.get("name") } }); setCreated(k.key); form.reset(); reload(); }
    catch (x) { setErr(describeError(x)); }
  }
  async function revoke() { if (!revoking) return; await api(`/api-keys/${revoking.id}`, { method: "DELETE" }); setRevoking(null); reload(); }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">API keys</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Use a key as <code className="rounded bg-paused-bg px-1">Authorization: Bearer &lt;key&gt;</code> to call the API from scripts.</p>
      {created && (
        <div role="status" className="mb-4 rounded-md border border-up/40 bg-up-bg p-3 text-sm">
          <p className="font-medium text-up">Copy your new key now. It won’t be shown again.</p>
          <code className="mt-2 block break-all rounded bg-surface p-2 text-ink">{created}</code>
          <Button className="mt-2" onClick={() => navigator.clipboard?.writeText(created)}>Copy key</Button>
        </div>
      )}
      <FormError message={err} />
      {error && <ErrorState message="Could not load API keys." onRetry={reload} />}
      <ul className="mb-4 divide-y divide-line rounded-md border border-line">
        {data?.length === 0 && <li className="p-4 text-sm text-muted">No API keys yet.</li>}
        {data?.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div><span className="font-medium">{k.name}</span> <span className="text-muted">· {k.prefix}… · {k.revoked_at ? "Revoked" : k.last_used_at ? `Used ${timeAgo(k.last_used_at)}` : "Never used"}</span></div>
            {!k.revoked_at && <Button variant="ghost" className="text-down" onClick={() => setRevoking(k)}>Revoke</Button>}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <Field label="Key name" htmlFor="key-name"><input id="key-name" name="name" required className={inputClass} placeholder="CI pipeline" /></Field>
        <Button type="submit" variant="primary">Create key</Button>
      </form>
      <ConfirmDialog open={!!revoking} title={`Revoke ${revoking?.name ?? "key"}?`} body="Anything using this key will immediately lose access." confirmLabel="Revoke key" onConfirm={revoke} onCancel={() => setRevoking(null)} />
    </Card>
  );
}

function StatusPage() {
  const { data, reload } = useApi<{ enabled: boolean; slug: string | null }>("/status-page");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setMsg(null);
    try { await api("/status-page", { method: "PUT", json: { enabled: f.get("enabled") === "on", slug: (f.get("slug") as string) || null } }); setMsg({ ok: true, text: "Status page saved." }); reload(); }
    catch (x) { setMsg({ ok: false, text: describeError(x) }); }
  }
  if (!data) return <Spinner />;
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Public status page</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Share the health of selected monitors without exposing their configuration. Choose monitors in each monitor’s settings.</p>
      <form key={`${data.enabled}-${data.slug}`} onSubmit={save} className="flex flex-col gap-4">
        {msg && (msg.ok ? <p role="status" className="rounded-md bg-up-bg px-3 py-2 text-sm text-up">{msg.text}</p> : <FormError message={msg.text} />)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={data.enabled} className="h-4 w-4 accent-[var(--accent)]" /> Make the status page public</label>
        <Field label="Page address" htmlFor="slug" hint="Lowercase letters, numbers and hyphens.">
          <input id="slug" name="slug" defaultValue={data.slug ?? ""} className={inputClass} placeholder="acme" />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary">Save</Button>
          {data.enabled && data.slug && <a className="text-sm font-medium text-accent hover:underline" href={`/status/${data.slug}`} target="_blank" rel="noreferrer">Open /status/{data.slug}</a>}
        </div>
      </form>
    </Card>
  );
}

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex max-w-3xl flex-col gap-6"><Channels /><StatusPage /><ApiKeys /></div>
    </>
  );
}
