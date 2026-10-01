"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { Button, Card, ConfirmDialog, Field, FormError, inputClass } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import { api, ApiError, describeError } from "@/lib/api";
import type { Monitor } from "@/lib/types";

/** Wrong current password is the user's fault, not a server problem: say it next to the field. */
function passwordMessage(e: unknown): string {
  if (e instanceof ApiError && e.code === "incorrect_password") return "Your current password is incorrect.";
  return describeError(e);
}

function Profile() {
  const { user, refresh } = useUser();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setError(null);
    try {
      await api("/account/email", { method: "POST", json: { new_email: f.get("new_email"), current_password: f.get("current_password") } });
      await refresh();
      form.reset();
      toast.success("Email updated. Use it the next time you log in.");
    } catch (err) { setError(passwordMessage(err)); }
    setBusy(false);
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Profile</h2>
      <dl className="mb-5 mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Email</dt><dd className="mt-0.5 break-all font-medium">{user.email}</dd></div>
        <div><dt className="text-muted">Member since</dt><dd className="mt-0.5 font-medium">{new Date(user.created_at).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}</dd></div>
      </dl>
      <form onSubmit={submit} className="flex flex-col gap-4 border-t border-line pt-5">
        <h3 className="font-medium">Change email</h3>
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New email address" htmlFor="new_email"><input id="new_email" name="new_email" type="email" required autoComplete="email" className={inputClass} /></Field>
          <Field label="Current password" htmlFor="email_password" hint="We ask again to confirm it's you."><input id="email_password" name="current_password" type="password" required autoComplete="current-password" className={inputClass} /></Field>
        </div>
        <div><Button type="submit" variant="primary" loading={busy}>Update email</Button></div>
      </form>
    </Card>
  );
}

function Password() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get("new_password") !== f.get("confirm_password")) { setError("The new passwords don't match."); return; }
    setBusy(true); setError(null);
    try {
      await api("/account/password", { method: "POST", json: { current_password: f.get("current_password"), new_password: f.get("new_password") } });
      form.reset();
      toast.success("Password changed. Other devices have been signed out.");
    } catch (err) { setError(passwordMessage(err)); }
    setBusy(false);
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Password</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Changing it signs you out everywhere else. You stay signed in here. API keys keep working.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormError message={error} />
        <Field label="Current password" htmlFor="current_password"><input id="current_password" name="current_password" type="password" required autoComplete="current-password" className={inputClass} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" htmlFor="new_password" hint="At least 10 characters."><input id="new_password" name="new_password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={inputClass} /></Field>
          <Field label="Confirm new password" htmlFor="confirm_password"><input id="confirm_password" name="confirm_password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} /></Field>
        </div>
        <div><Button type="submit" variant="primary" loading={busy}>Change password</Button></div>
      </form>
    </Card>
  );
}

function DangerZone() {
  const router = useRouter();
  const toast = useToast();
  const monitors = useApi<Monitor[]>("/monitors");
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = monitors.data?.length;

  function close() { setOpen(false); setPassword(""); setError(null); }

  async function remove() {
    setBusy(true); setError(null);
    try {
      await api("/account/delete", { method: "POST", json: { current_password: password } });
      router.replace("/login");
    } catch (err) { setError(passwordMessage(err)); toast.error("Your account was not deleted."); setBusy(false); }
  }

  return (
    <Card className="border-down/40 p-6">
      <h2 className="text-lg font-semibold text-down">Delete account</h2>
      <p className="mb-4 mt-1 text-sm text-muted">
        Permanently deletes your account{count ? ` and your ${count} ${count === 1 ? "monitor" : "monitors"}` : ""}, with all check history, incidents, notification channels and API keys. This can&apos;t be undone.
      </p>
      <Button variant="danger" onClick={() => setOpen(true)}>Delete my account…</Button>
      <ConfirmDialog open={open} title="Delete your account?" confirmLabel="Delete account" busy={busy} confirmDisabled={!password}
        body="Enter your password to confirm. Everything in your account will be erased immediately."
        onConfirm={remove} onCancel={close}>
        <FormError message={error} />
        <Field label="Password" htmlFor="delete_password">
          <input id="delete_password" type="password" autoComplete="current-password" className={inputClass} value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && password && !busy) remove(); }} />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}

export function Account() {
  return (
    <>
      <Profile />
      <Password />
      <DangerZone />
    </>
  );
}
