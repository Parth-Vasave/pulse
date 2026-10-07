"use client";

import { useState } from "react";
import { ExternalIcon, PlusIcon, SendIcon, TrashIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { Badge, Button, ConfirmDialog, CopyButton, ErrorState, Field, FormError, IconButton, LinkButton, SkeletonRows, Toggle, inputClass } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { ApiKey, Channel } from "@/lib/types";

export function ApiKeys() {
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
    <section className="py-8 first:pt-0">
      <h2 className="text-[17px] font-medium tracking-tight">API keys</h2>
      <p className="mb-5 mt-1 max-w-prose text-[15px] text-muted">Use a key as <code className="rounded bg-raised px-1 font-mono text-sm text-ink">Authorization: Bearer &lt;key&gt;</code> to call the API from scripts.</p>
      {created && (
        <div role="status" className="mb-4 border-y border-line-strong py-3 text-[15px]">
          <p className="font-medium text-ink">Copy your new key now. It won’t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-surface p-2 font-mono text-sm text-ink">{created}</code>
            <CopyButton text={created} label="Copy key" />
          </div>
        </div>
      )}
      <FormError message={err} />
      {error && <ErrorState message="Could not load API keys." onRetry={reload} />}
      <ul className="mb-4 divide-y divide-line border-y border-line">
        {data?.length === 0 && <li className="py-4 text-[15px] text-muted">No API keys yet.</li>}
        {data?.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[15px]">
            <div><span className="font-medium">{k.name}</span> <span className="font-mono text-sm text-muted">{k.prefix}…</span> <span className="text-muted">· {k.revoked_at ? "Revoked" : k.last_used_at ? `Used ${timeAgo(k.last_used_at)}` : "Never used"}</span></div>
            {!k.revoked_at && <Button size="sm" variant="danger-ghost" onClick={() => setRevoking(k)}>Revoke</Button>}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <Field label="Key name" htmlFor="key-name"><input id="key-name" name="name" required className={inputClass} placeholder="CI pipeline" /></Field>
        <Button type="submit" variant="primary" loading={busy} icon={<PlusIcon />}>Create key</Button>
      </form>
      <ConfirmDialog open={!!revoking} title={`Revoke ${revoking?.name ?? "key"}?`} body="Anything using this key will immediately lose access." confirmLabel="Revoke key" onConfirm={revoke} onCancel={() => setRevoking(null)} />
    </section>
  );
}
