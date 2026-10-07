"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Logo";
import { GitHubIcon } from "@/components/icons";
import { LinkButton } from "@/components/ui";
import { api } from "@/lib/api";
import { REPO } from "@/components/home/links";

const LINKS = [
  { href: "#replay", label: "How it works" },
  { href: "#ships", label: "Features" },
  { href: "#start", label: "Quick start" },
];

/** The public top bar. Signed-in visitors get "Open dashboard" in place of "Log in". */
export function HomeHeader() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    api("/auth/me").then(() => setSignedIn(true)).catch(() => setSignedIn(false));
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
        <Link href="/" aria-label="Pulse, home" className="rounded-md"><Wordmark /></Link>
        <nav aria-label="Page" className="flex items-center gap-0.5 max-md:hidden">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-md px-2 py-1 text-[15px] text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">{l.label}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a href={REPO} className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[15px] text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
            <GitHubIcon /><span className="max-sm:sr-only">GitHub</span>
          </a>
          {/* Hold the slot while the session check runs so the bar doesn't shift. */}
          <span className={`ml-1 transition-opacity duration-200 ${signedIn === null ? "opacity-0" : "opacity-100"}`}>
            {signedIn
              ? <LinkButton href="/dashboard" size="sm">Open dashboard</LinkButton>
              : <LinkButton href="/login" size="sm" tabIndex={signedIn === null ? -1 : undefined}>Log in</LinkButton>}
          </span>
        </div>
      </div>
    </header>
  );
}
