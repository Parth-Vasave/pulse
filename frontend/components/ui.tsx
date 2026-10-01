"use client";

import { useEffect, useRef } from "react";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" };

export function Button({ variant = "secondary", className = "", ...props }: BtnProps) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    secondary: "bg-surface text-ink border border-line hover:bg-paused-bg",
    danger: "bg-down text-white hover:opacity-90",
    ghost: "text-muted hover:text-ink hover:bg-paused-bg",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-lg border border-line bg-surface ${className}`} />;
}

export function PageHeader({ title, children, sub }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-8 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden />
      {label}…
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted">{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-down/40 bg-down-bg p-4 text-sm text-down">
      <p>{message}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-down/40 bg-down-bg px-3 py-2 text-sm text-down">
      {message}
    </p>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p id={`${htmlFor}-hint`} className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm placeholder:text-muted/70 focus-visible:border-accent";

/** Native <dialog>: focus trap, Esc to close and inert background come for free. */
export function ConfirmDialog({
  open, title, body, confirmLabel, onConfirm, onCancel, busy,
}: {
  open: boolean; title: string; body: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby="dlg-title"
      className="m-auto w-[min(92vw,26rem)] rounded-lg border border-line bg-surface p-0 text-ink">
      <div className="flex flex-col gap-4 p-6">
        <h2 id="dlg-title" className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">{body}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
