"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings/account", label: "Account", hint: "Email, password" },
  { href: "/settings/notifications", label: "Notifications", hint: "Where alerts go" },
  { href: "/settings/status-page", label: "Status page", hint: "Public page" },
  { href: "/settings/api-keys", label: "API keys", hint: "Script access" },
];

/** Sidebar on desktop, scrollable tab row on phones. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {ITEMS.map((i) => {
          const active = pathname === i.href;
          return (
            <li key={i.href} className="shrink-0">
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-surface font-semibold text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-paused-bg hover:text-ink"}`}>
                {i.label}
                <span className="hidden text-xs font-normal text-muted md:block">{i.hint}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
