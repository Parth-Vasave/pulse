"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "danger" | "ghost" | "danger-ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink shadow-sm hover:brightness-110 active:brightness-95",
  secondary: "border border-line bg-surface text-ink shadow-sm hover:bg-paused-bg active:bg-line/60",
  danger: "bg-down text-white shadow-sm hover:brightness-110 active:brightness-95",
  ghost: "text-muted hover:bg-paused-bg hover:text-ink active:bg-line/60",
  "danger-ghost": "text-down hover:bg-down-bg active:brightness-95",
};
const SIZES: Record<Size, string> = { sm: "h-8 gap-1.5 px-3 text-sm", md: "h-9 gap-2 px-4 text-sm" };

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra = "") {
  return `inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-[background-color,filter,color] duration-150 disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function ButtonSpinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size; icon?: React.ReactNode; loading?: boolean;
};

/** `loading` keeps the label, shows a spinner and disables the button so it can't be double-submitted. */
export function Button({ variant = "secondary", size = "md", icon, loading, className = "", children, disabled, type = "button", ...props }: BtnProps) {
  return (
    <button type={type} {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading ? <ButtonSpinner /> : icon}
      {children}
    </button>
  );
}

/** A navigation link that looks like a button, so links keep link semantics (open in new tab, etc.). */
export function LinkButton({ href, variant = "secondary", size = "md", icon, className = "", children, ...props }:
  { href: string; variant?: Variant; size?: Size; icon?: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} {...props} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}

/** Icon-only button: 36px hit target, required accessible name, native tooltip. */
export function IconButton({ label, variant = "ghost", className = "", children, ...props }:
  { label: string; variant?: Variant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} {...props}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy", size = "sm" }: { text: string; label?: string; size?: Size }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable (insecure context): user can still select the text */ }
  }
  return (
    <Button size={size} onClick={copy} icon={copied ? <CheckIcon className="text-up" /> : <CopyIcon />} aria-live="polite">
      {copied ? "Copied" : label}
    </Button>
  );
}

/* ---------- Controls ---------- */

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50 ${checked ? "border-up bg-up" : "border-line bg-paused-bg"}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export function SegmentedControl<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`h-8 rounded-md px-3 text-sm font-medium transition-colors duration-150 ${value === o.value ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "up" | "down" | "warn" }) {
  const t = { neutral: "bg-paused-bg text-paused", up: "bg-up-bg text-up", down: "bg-down-bg text-down", warn: "bg-warn-bg text-warn" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

/* ---------- Layout / feedback ---------- */

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-lg border border-line bg-surface ${className}`} />;
}

export function PageHeader({ title, children, sub }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
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

/** Placeholder rows keep layout stable while data loads. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-4 w-40 animate-pulse rounded bg-paused-bg" />
          <div className="h-6 w-16 animate-pulse rounded-full bg-paused-bg" />
          <div className="ml-auto h-4 w-24 animate-pulse rounded bg-paused-bg" />
        </div>
      ))}
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
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
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
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm shadow-sm placeholder:text-muted/70 transition-colors hover:border-muted/60 focus-visible:border-accent";
export const textareaClass = inputClass.replace("h-9 ", "py-2 ");

/** Native <dialog>: focus trap, Esc to close and inert background come for free. */
export function ConfirmDialog({
  open, title, body, confirmLabel, onConfirm, onCancel, busy, confirmDisabled, children,
}: {
  open: boolean; title: string; body: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; busy?: boolean; confirmDisabled?: boolean; children?: React.ReactNode;
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
      className="m-auto w-[min(92vw,26rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl">
      <div className="flex flex-col gap-4 p-6">
        <h2 id="dlg-title" className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">{body}</p>
        {children}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={busy} disabled={confirmDisabled}>{confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
