"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { Wordmark } from "@/components/Logo";
import { Sleeve } from "@/components/Sleeve";
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
      router.replace("/dashboard");
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="hidden border-r border-line lg:flex">
        <Sleeve />
      </div>
      <div className="flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-10 lg:hidden"><Wordmark /></div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{isLogin ? "Log in to your account" : "Create your account"}</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          {isLogin ? "See which of your APIs are up right now." : "Start monitoring your first API in a minute."}
        </p>
        <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
          <FormError message={error} />
          <Field label="Email" htmlFor="email">
            <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
          </Field>
          <Field label="Password" htmlFor="password" hint={isLogin ? undefined : "At least 10 characters."}>
            <input id="password" name="password" type="password" required minLength={isLogin ? 1 : 10}
              autoComplete={isLogin ? "current-password" : "new-password"} aria-describedby={isLogin ? undefined : "password-hint"} className={inputClass} />
          </Field>
          <Button type="submit" variant="primary" loading={busy} className="mt-2 h-9 w-full">{isLogin ? "Log in" : "Create account"}</Button>
        </form>
        <p className="mt-8 border-t border-line pt-6 text-[15px] text-muted">
          {isLogin ? "New here? " : "Already have an account? "}
          <Link href={isLogin ? "/register" : "/login"} className="font-medium text-ink underline decoration-line-strong hover:decoration-ink">
            {isLogin ? "Create an account" : "Log in"}
          </Link>
        </p>
      </div>
      </div>
    </main>
  );
}
