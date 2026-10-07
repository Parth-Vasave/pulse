"use client";

import { useState } from "react";
import { ExternalIcon, PlusIcon, SendIcon, TrashIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { Badge, Button, ConfirmDialog, CopyButton, ErrorState, Field, FormError, IconButton, LinkButton, SkeletonRows, Toggle, inputClass } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, describeError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { ApiKey, Channel } from "@/lib/types";

export function StatusPage() {
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
  if (!data) return <section className="py-8 first:pt-0"><SkeletonRows rows={2} /></section>;
  return (
    <section className="py-8 first:pt-0">
      <h2 className="text-[17px] font-medium tracking-tight">Public status page</h2>
      <p className="mb-5 mt-1 max-w-prose text-[15px] text-muted">Share the health of selected monitors without exposing their configuration. Choose monitors in each monitor’s settings.</p>
      <form key={`${data.enabled}-${data.slug}`} onSubmit={save} className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="flex items-center gapx-4 py-3 text-[15px]">
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
    </section>
  );
}
