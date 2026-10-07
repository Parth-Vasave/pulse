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
      <ul className="flex border-b border-line md:flex-col md:border-b-0 md:border-l">
        {ITEMS.map((i) => {
          const active = pathname === i.href;
          return (
            <li key={i.href} className="shrink-0">
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={`-mb-px block border-b px-3 py-2 text-[15px] transition-colors duration-150 md:-ml-px md:mb-0 md:border-b-0 md:border-l md:py-1.5 ${active ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                {i.label}
                <span className="hidden text-sm font-normal text-muted md:block">{i.hint}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
