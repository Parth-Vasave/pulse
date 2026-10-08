"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/Logo";
import { Spinner } from "@/components/ui";
import { api, redirectToLogin } from "@/lib/api";

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
  { href: "/dashboard", label: "Dashboard" },
  { href: "/incidents", label: "Incidents" },
  { href: "/settings", label: "Settings" },
];

/** Top nav whose underline slides to the selected item. It moves on click, before the route has loaded. */
function MainNav({ current }: { current: string | null }) {
  // A click wins only until the route changes, so back/forward and links outside the nav still move the underline.
  const [clicked, setClicked] = useState<{ href: string; from: string | null } | null>(null);
  const selected = clicked && clicked.from === current ? clicked.href : current;
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  const links = useRef(new Map<string, HTMLAnchorElement>());

  useLayoutEffect(() => {
    const measure = () => {
      const el = selected ? links.current.get(selected) : undefined;
      setBar(el ? { left: el.offsetLeft + 8, width: el.offsetWidth - 16 } : null);
    };
    measure();
    // Re-measure once web fonts settle or the window resizes, since both change link widths.
    document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [selected]);

  // Skip the transition on the first placement so the underline doesn't fly in from the left edge.
  useEffect(() => {
    if (bar && !animate) requestAnimationFrame(() => setAnimate(true));
  }, [bar, animate]);

  return (
    <nav aria-label="Main" className="relative flex h-full items-center gap-0.5 max-sm:-ml-2">
      {bar && (
        <span aria-hidden
          className={`absolute -bottom-px h-px bg-ink ${animate ? "transition-[left,width] duration-300 ease-[var(--ease-out-expo)]" : ""}`}
          style={{ left: bar.left, width: bar.width }} />
      )}
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} aria-current={current === n.href ? "page" : undefined}
          ref={(el) => { if (el) links.current.set(n.href, el); else links.current.delete(n.href); }}
          onClick={(e) => { if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) setClicked({ href: n.href, from: current }); }}
          className={`rounded-md px-2 py-1 text-[15px] transition-colors duration-200 hover:bg-raised ${selected === n.href ? "text-ink" : "text-muted hover:text-ink"}`}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);

  const refresh = useCallback(async () => {
    setUser(await api<CurrentUser>("/auth/me"));
  }, []);

  useEffect(() => {
    api<CurrentUser>("/auth/me").then(setUser).catch(() => redirectToLogin());
  }, []);

  if (!user) return <div className="mx-auto max-w-6xl px-4"><Spinner label="Checking your session" /></div>;

  const active = (href: string) => (href === "/dashboard" ? pathname.startsWith("/dashboard") || pathname.startsWith("/monitors") : pathname.startsWith(href));

  return (
    <UserContext.Provider value={{ user, refresh }}>
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4 max-sm:gap-4">
          <Link href="/dashboard" aria-label="Pulse, dashboard" className="rounded-md">
            <Wordmark />
          </Link>
          <div className="h-full">
            <MainNav current={NAV.find((n) => active(n.href))?.href ?? null} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:pt-10">{children}</main>
    </div>
    </UserContext.Provider>
  );
}
