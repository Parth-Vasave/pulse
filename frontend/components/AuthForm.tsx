"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { Button, Field, FormError, inputClass } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/${mode}`, { method: "POST", json: { email: form.get("email"), password: form.get("password") } });
      router.replace("/");
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
            <path d="M2 12h4l3-8 4 16 3-8h6" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Pulse
        </div>
        <h1 className="text-xl font-semibold">{isLogin ? "Log in to your account" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-muted">
          {isLogin ? "See which of your APIs are up right now." : "Start monitoring your first API in a minute."}
        </p>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <FormError message={error} />
          <Field label="Email" htmlFor="email">
            <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
          </Field>
          <Field label="Password" htmlFor="password" hint={isLogin ? undefined : "At least 10 characters."}>
            <input id="password" name="password" type="password" required minLength={isLogin ? 1 : 10}
              autoComplete={isLogin ? "current-password" : "new-password"} aria-describedby={isLogin ? undefined : "password-hint"} className={inputClass} />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Please wait…" : isLogin ? "Log in" : "Create account"}</Button>
        </form>
        <p className="mt-6 text-sm text-muted">
          {isLogin ? "New here? " : "Already have an account? "}
          <Link href={isLogin ? "/register" : "/login"} className="font-medium text-accent underline-offset-2 hover:underline">
            {isLogin ? "Create an account" : "Log in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
