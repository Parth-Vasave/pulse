"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Spinner } from "@/components/ui";

export interface CurrentUser { id: number; email: string; created_at: string }
interface UserCtx { user: CurrentUser; refresh: () => Promise<void> }
export const UserContext = createContext<UserCtx | null>(null);

/** The signed-in user, refreshable after account changes (e.g. a new email address). */
export function useUser(): UserCtx {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used inside AppShell");
  return ctx;
}

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/incidents", label: "Incidents" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);

  const refresh = useCallback(async () => {
    setUser(await api<CurrentUser>("/auth/me"));
  }, []);

  useEffect(() => {
    api<CurrentUser>("/auth/me").then(setUser).catch(() => router.replace("/login"));
  }, [router]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  if (!user) return <Spinner label="Checking your session" />;

  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/monitors") : pathname.startsWith(href));

  return (
    <UserContext.Provider value={{ user, refresh }}>
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
                <path d="M2 12h4l3-8 4 16 3-8h6" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Pulse
            </Link>
            <nav aria-label="Main" className="flex gap-1">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${active(n.href) ? "bg-paused-bg text-ink" : "text-muted hover:text-ink"}`}>
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={logout}>Log out</Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
    </UserContext.Provider>
  );
}
