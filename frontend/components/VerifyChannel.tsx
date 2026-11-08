"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { api, describeError } from "@/lib/api";
import { Wordmark } from "@/components/Logo";
import { Button, FormError } from "@/components/ui";

const noSubscription = () => () => {};

/** The token arrives in the URL fragment so it never reaches a server log. Read it in the browser only. */
function readToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

/**
 * Where the link in a channel confirmation email lands. Confirming takes a click rather than happening on load:
 * mail scanners open links on their own, and they must not be able to confirm an address for its owner.
 */
export function VerifyChannel() {
  const token = useSyncExternalStore(noSubscription, readToken, () => null);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState("busy"); setError(null);
    try {
      await api("/public/verify-channel", { method: "POST", json: { token } });
      setState("done");
    } catch (err) {
      setError(describeError(err)); setState("idle");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-10"><Wordmark /></div>
        {state === "done" ? (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Address confirmed</h1>
            <p role="status" className="mt-1.5 text-[15px] text-muted">Pulse will email incident alerts here from now on. You can close this page.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Confirm alert emails</h1>
            <p className="mt-1.5 text-[15px] text-muted">
              Someone asked Pulse to send API incident alerts to your email address. Confirm only if you want to receive them.
              If you don&apos;t, close this page and nothing will be sent.
            </p>
            <div className="mt-8 flex flex-col gap-4">
              <FormError message={token ? error : "This link is incomplete. Open the link from the email again."} />
              <Button variant="primary" className="h-9 w-full" loading={state === "busy"} disabled={!token} onClick={confirm}>
                Send alerts to this address
              </Button>
            </div>
          </>
        )}
        <p className="mt-8 border-t border-line pt-6 text-[15px] text-muted">
          <Link href="/" className="font-medium text-ink underline decoration-line-strong hover:decoration-ink">What is Pulse?</Link>
        </p>
      </div>
    </main>
  );
}
