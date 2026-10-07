"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { VARIANTS, buttonClass, type Size, type Variant } from "@/components/buttonStyles";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "@/components/icons";

/* ---------- Buttons ---------- */

// Button styles live in a plain module so server components can style links as buttons too.
export { buttonClass };

export function ButtonSpinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" aria-hidden />;
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

/** Icon-only button: 32px hit target, required accessible name, native tooltip. */
export function IconButton({ label, variant = "ghost", className = "", children, ...props }:
  { label: string; variant?: Variant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} {...props}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy", size = "sm", variant = "secondary" }: { text: string; label?: string; size?: Size; variant?: Variant }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable (insecure context): user can still select the text */ }
  }
  return (
    <Button size={size} variant={variant} onClick={copy} icon={copied ? <CheckIcon /> : <CopyIcon />} aria-live="polite">
      {copied ? "Copied" : label}
    </Button>
  );
}

/* ---------- Controls ---------- */

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40 ${checked ? "bg-ink" : "bg-line-strong"}`}>
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-canvas shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-[var(--ease-out-expo)] ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

export function SegmentedControl<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`h-8 rounded-[5px] px-3 text-[15px] transition-colors duration-150 ${value === o.value ? "bg-raised font-medium text-ink" : "text-muted hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "up" | "down" | "warn" }) {
  const t = { neutral: "border-line-strong text-muted", up: "border-up/40 text-up", down: "border-down/40 text-down", warn: "border-warn/40 text-warn" }[tone];
  return <span className={`inline-flex h-5 items-center rounded border px-1.5 font-mono text-[13px] ${t}`}>{children}</span>;
}

/* ---------- Layout / feedback ---------- */

/** A hairline-bordered panel. Used for forms and lists that need a frame; never nested. */
export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-lg border border-line bg-surface ${className}`} />;
}

/** A titled block separated from the one above by a hairline: the default section on every page. */
export function Section({ title, description, actions, children, className = "" }:
  { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-t border-line pt-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-medium tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 max-w-prose text-[15px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, children, sub }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-balance">{title}</h1>
        {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** "← Dashboard" style link back to the parent page. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1.5 text-[15px] text-muted transition-colors hover:text-ink">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 3L5 8l5 5" /></svg>
      {children}
    </Link>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-[15px] text-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line-strong border-t-ink" aria-hidden />
      {label}…
    </div>
  );
}

/** Placeholder rows keep layout stable while data loads. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-4">
          <div className="h-3 w-40 animate-pulse rounded-sm bg-raised" />
          <div className="h-3 w-12 animate-pulse rounded-sm bg-raised" />
          <div className="ml-auto h-3 w-24 animate-pulse rounded-sm bg-raised" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-10">
      <h2 className="text-[17px] font-medium">{title}</h2>
      <p className="max-w-md text-[15px] text-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-down/30 bg-down-bg px-4 py-3 text-[15px] text-down">
      <p>{message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-down/30 bg-down-bg px-3 py-2 text-[15px] text-down">
      {message}
    </p>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[15px] font-medium text-ink-2">{label}</label>
      {children}
      {hint && <p id={`${htmlFor}-hint`} className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] text-ink transition-[border-color,box-shadow] duration-150 hover:border-faint focus-visible:border-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink/10";
export const textareaClass = inputClass.replace("h-9 ", "py-2 font-mono text-sm leading-6 ");

/** A native <select> (keyboard and mobile pickers for free) with the OS chrome replaced by an authored chevron. */
export function Select({ className: _ignored, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={`${inputClass} appearance-none pr-8`}>{children}</select>
      <ChevronDownIcon width={14} height={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

/**
 * An inline label picker ("Sorted by status") that opens a floating listbox. Used where the native select's OS popup
 * would be the one foreign object on the page; keyboard follows the listbox pattern (arrows, Home/End, Enter, Esc).
 */
export function MenuSelect<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => { if (open) list.current?.focus(); }, [open]);

  function show() { setCursor(selected); setOpen(true); }
  function close(refocus = true) { setOpen(false); if (refocus) button.current?.focus(); }
  function pick(i: number) { onChange(options[i].value); close(); }

  function onListKey(e: React.KeyboardEvent) {
    const last = options.length - 1;
    const to = ({ ArrowDown: Math.min(cursor + 1, last), ArrowUp: Math.max(cursor - 1, 0), Home: 0, End: last } as Record<string, number>)[e.key];
    if (to !== undefined) { e.preventDefault(); setCursor(to); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(cursor); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  return (
    <div ref={root} className="relative inline-flex items-baseline gap-1.5"
      onBlur={(e) => { if (open && !root.current?.contains(e.relatedTarget)) close(false); }}>
      <span id={`${id}-label`} className="caps">{label}</span>
      <button ref={button} id={`${id}-button`} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
        aria-labelledby={`${id}-label ${id}-button`}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); } }}
        className="caps inline-flex items-center gap-1 rounded-sm !text-ink">
        {options[selected]?.label.toLowerCase()}
        <ChevronDownIcon width={12} height={12} className={`text-muted transition-transform duration-200 ease-[var(--ease-out-expo)] ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-${cursor}`} onKeyDown={onListKey}
          className="toast-in absolute right-0 top-full z-30 mt-2 min-w-[13rem] rounded-lg border border-line-strong bg-surface p-1 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.3)] outline-none focus-visible:outline-none">
          {options.map((o, i) => (
            <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={i === selected}
              onPointerMove={() => setCursor(i)} onClick={() => pick(i)}
              className={`flex h-8 cursor-pointer items-center justify-between gap-6 rounded-[5px] px-2.5 text-[15px] transition-colors duration-100
                ${i === cursor ? "bg-raised text-ink" : "text-muted"} ${i === selected ? "font-medium text-ink" : ""}`}>
              {o.label}
              {i === selected && <CheckIcon width={14} height={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      className="m-auto w-[min(92vw,26rem)] rounded-xl border border-line-strong bg-surface p-0 text-ink shadow-[0_24px_48px_-12px_rgb(0_0_0/0.35)]">
      <div className="flex flex-col gap-3 p-5">
        <h2 id="dlg-title" className="text-[17px] font-semibold">{title}</h2>
        <p className="text-[15px] text-muted">{body}</p>
        {children}
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} loading={busy} disabled={confirmDisabled}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
