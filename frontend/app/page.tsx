import type { Metadata } from "next";
import { HomeHeader } from "@/components/home/HomeHeader";
import { IncidentReplay } from "@/components/home/IncidentReplay";
import { INSTALL, REPO, doc } from "@/components/home/links";
import { LogoMark } from "@/components/Logo";
import { ArrowRightIcon, GitHubIcon } from "@/components/icons";
import { buttonClass } from "@/components/buttonStyles";
import { CopyButton } from "@/components/ui";

export const metadata: Metadata = {
  title: { absolute: "Pulse – open-source API monitoring and incident detection" },
  description:
    "Self-hosted API monitoring. Workers check your endpoints on a schedule, open an incident after N failures in a row, resolve it after M passes, and alert you by email, webhook or Discord.",
};

function Commands({ lines, primary = false }: { lines: string[]; primary?: boolean }) {
  return (
    <div className="rounded-md border border-line-strong bg-surface">
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-sm leading-7 text-ink">
        {lines.map((l) => <span key={l} className="block"><span className="select-none text-muted">$ </span>{l}</span>)}
      </pre>
      <div className="flex items-center justify-between gap-3 border-t border-line px-2 py-2 pl-4">
        <span className="font-mono text-[13px] text-muted">Docker Compose · {lines.length} commands</span>
        <CopyButton text={lines.join("\n")} label="Copy commands" variant={primary ? "primary" : "secondary"} />
      </div>
    </div>
  );
}

function SectionHead({ id, title, children }: { id?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-10 grid gap-x-12 gap-y-3 md:grid-cols-[13rem_minmax(0,1fr)]">
      <h2 id={id} className="scroll-mt-20 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-balance">{title}</h2>
      {children && <div className="max-w-[42rem] text-[17px] leading-relaxed text-ink-2 md:pt-1.5">{children}</div>}
    </div>
  );
}

const C = ({ children }: { children: React.ReactNode }) => <code className="break-words font-mono text-[14px] text-ink">{children}</code>;

const SHIPS: { group: string; items: React.ReactNode[] }[] = [
  {
    group: "Checks",
    items: [
      <><C>GET</C> <C>POST</C> <C>PUT</C> <C>PATCH</C> <C>DELETE</C> with headers and a JSON or text body</>,
      <>Every <C>30 s</C> to every <C>24 h</C>, with a timeout and an optional response-time threshold</>,
      <>Response assertions: <C>body_contains</C>, <C>body_not_contains</C>, <C>json_field</C></>,
      <>Immediate retries on network errors before a failure counts</>,
    ],
  },
  {
    group: "Incidents",
    items: [
      <>A pure state machine: <C>N</C> failures in a row open an incident, <C>M</C> passes resolve it</>,
      <>One open incident per monitor, enforced by the database even when workers race</>,
      <>A full timeline for every incident: each failure, alert and recovery check</>,
      <>Pausing or re-pointing a monitor closes its incident, so there is no false recovery alert</>,
    ],
  },
  {
    group: "Causes",
    items: [
      <>Every failure is classified: <C>timeout</C>, <C>dns_failure</C>, <C>connect_failure</C>, <C>invalid_response</C>, <C>unexpected_status</C>, <C>http_error</C>, <C>assertion_failed</C>, <C>slow_response</C>, <C>blocked_target</C></>,
    ],
  },
  {
    group: "Alerts",
    items: [
      <>Email over SMTP, a generic webhook, or Discord</>,
      <>Retries with backoff; a send that still fails is written to the incident timeline</>,
    ],
  },
  {
    group: "Numbers",
    items: [
      <>Response time, availability and errors by cause over <C>1 h</C> <C>24 h</C> <C>7 d</C> <C>30 d</C></>,
      <>Average, <C>P50</C>, <C>P95</C> and <C>P99</C> latency; uptime and downtime, time-weighted and never rounded up</>,
    ],
  },
  {
    group: "Sharing",
    items: [
      <>A public status page per account</>,
      <>API keys, hashed at rest, shown once, revocable</>,
    ],
  },
  {
    group: "Security",
    items: [
      <>Argon2id passwords, HttpOnly cookies, every query scoped to its owner</>,
      <>SSRF protection checked at connect time against the exact IP, so DNS rebinding can’t slip through</>,
      <>Monitor headers and webhook URLs encrypted at rest, with key rotation</>,
      <>Rate limits, request size limits and security headers</>,
    ],
  },
  {
    group: "Operations",
    items: [
      <>Structured JSON logs, Prometheus metrics, <C>/health</C> and <C>/ready</C></>,
      <>Pulse watches itself: scheduler tick metrics, ready-made alert rules and a dead-man’s-switch ping</>,
    ],
  },
];

function Node({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={`inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-md border px-3 font-mono text-sm ${strong ? "border-ink text-ink" : "border-line-strong text-ink-2"}`}>
      {children}
    </span>
  );
}

function Arrow() {
  return (
    <svg width="28" height="12" viewBox="0 0 28 12" fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0 max-md:my-1 max-md:h-5 max-md:w-3 max-md:rotate-90" aria-hidden>
      <path d="M1 6h25M21 1.5L26 6l-5 4.5" />
    </svg>
  );
}

function Flow({ label, nodes, strong }: { label: string; nodes: string[]; strong?: string }) {
  return (
    <div className="grid gap-x-12 gap-y-3 border-t border-line py-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <p className="caps pt-2">{label}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 max-md:flex-col max-md:items-start">
        {nodes.map((n, i) => (
          <span key={n} className="contents">
            {i > 0 && <Arrow />}
            <Node strong={n === strong}>{n}</Node>
          </span>
        ))}
      </div>
    </div>
  );
}

const URLS = [
  { url: "localhost:3000", what: "The app. Log in as demo@example.com / demo-password-123" },
  { url: "localhost:8000/docs", what: "API reference (OpenAPI)" },
  { url: "localhost:8025", what: "Mailpit, which catches every alert email" },
  { url: "localhost:9000", what: "Demo target API with a fail / restore switch" },
];

const STACK = [
  { layer: "Interface", value: "Next.js 16 · React 19 · TypeScript · Tailwind 4" },
  { layer: "API", value: "Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic" },
  { layer: "Checks", value: "Celery workers · Celery Beat · Redis 7" },
  { layer: "Storage", value: "PostgreSQL 16" },
];

export default function Home() {
  return (
    <div className="relative isolate min-h-screen">
      <div className="home-glow" aria-hidden />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <HomeHeader />

      <main id="main" className="mx-auto max-w-6xl px-4">
        {/* Release header: what this is, and how to get it. */}
        <section className="pb-14 pt-12 sm:pt-16">
          <h1 className="text-[clamp(2.5rem,6.4vw,4.75rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-balance">
            Every check kept.<br className="max-sm:hidden" /> Every incident explained.
          </h1>
          <div className="mt-8 grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_31rem]">
            <div className="min-w-0">
              <p className="max-w-[36rem] text-[18px] leading-relaxed text-ink-2 text-pretty">
                Pulse is open-source API monitoring you run yourself. Workers check your endpoints on a schedule, open an incident after <span className="font-mono text-[17px]">N</span> failures
                in a row, resolve it after <span className="font-mono text-[17px]">M</span> passes, and tell you by email, webhook or Discord.
              </p>
              <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[13px]">
                {[["Licence", "MIT"], ["Runs on", "Docker Compose"], ["Built with", "FastAPI · Next.js"]].map(([k, v]) => (
                  <div key={k} className="flex gap-2"><dt className="text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>
                ))}
              </dl>
            </div>
            <div className="min-w-0">
              <Commands lines={INSTALL} primary />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={REPO} className={buttonClass("secondary", "md")}><GitHubIcon />View on GitHub</a>
                <a href="#replay" className={buttonClass("ghost", "md")}>See it catch an outage<ArrowRightIcon /></a>
              </div>
            </div>
          </div>
        </section>

        {/* The headline feature: the incident engine, replayed. */}
        <section aria-labelledby="replay" className="border-t border-line pb-24 pt-6">
          <div className="mb-8 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
            <h2 id="replay" className="scroll-mt-20 text-[17px] font-medium tracking-tight">Watch it catch an outage</h2>
            <p className="font-mono text-[13px] text-muted">Replay at 60× · synthetic latencies · Pulse’s own event and alert wording</p>
          </div>
          <IncidentReplay />
          <p className="mt-10 max-w-[42rem] text-[15px] leading-relaxed text-muted">
            This is the demo walkthrough from the README: the target starts returning <span className="font-mono">500</span>. A single failure is only counted.
            Three in a row open one incident and send one email; two passes resolve it. Hover or focus the lane to read any check.
          </p>
        </section>

        {/* Release notes: what ships. */}
        <section aria-labelledby="ships" className="border-t border-line pb-24 pt-10">
          <SectionHead id="ships" title="What ships">
            <p>Everything below is in the repository today, with tests. No hosted tier, no paid features, no synthetic health score.</p>
          </SectionHead>
          <div>
            {SHIPS.map((g) => (
              <div key={g.group} className="grid gap-x-12 gap-y-3 border-t border-line py-6 md:grid-cols-[13rem_minmax(0,1fr)]">
                <h3 className="text-[17px] font-medium tracking-tight">{g.group}</h3>
                <ul className="grid min-w-0 gap-x-10 gap-y-3 text-[15px] leading-relaxed text-ink-2 lg:grid-cols-2">
                  {g.items.map((it, i) => <li key={i} className="max-w-[34rem]">{it}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture. */}
        <section aria-labelledby="how" className="border-t border-line pb-24 pt-10">
          <SectionHead id="how" title="How it runs">
            <p>
              The API never runs checks. Beat only enqueues. Workers do the work, and the incident engine decides. Each piece can stop and come back
              without losing a check: stop Redis or Postgres for half a minute and Pulse serves clean <span className="font-mono text-[16px]">503</span>s, then resumes on its own.
            </p>
          </SectionHead>
          <Flow label="You and the app" nodes={["Browser", "Next.js", "FastAPI", "PostgreSQL"]} />
          <Flow label="Every check" nodes={["Celery Beat", "Redis queue", "Celery workers", "Your APIs"]} />
          <Flow label="Every result" nodes={["Celery workers", "Incident engine", "Email · Webhook · Discord"]} strong="Incident engine" />
          <div className="grid gap-x-12 border-t border-line pt-6 md:grid-cols-[13rem_minmax(0,1fr)]">
            <span aria-hidden />
            <a href={doc("ARCHITECTURE")} className="inline-flex items-center gap-1.5 justify-self-start text-[15px] text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink">
              Read the architecture and design rationale<ArrowRightIcon />
            </a>
          </div>
        </section>

        {/* Quick start. */}
        <section aria-labelledby="start" className="border-t border-line pb-24 pt-10">
          <SectionHead id="start" title="Run the demo">
            <p>Compose starts Postgres and Redis, runs the migrations, seeds a demo account with history, then brings up the API, workers, scheduler and app.</p>
          </SectionHead>
          <div className="grid gap-x-12 gap-y-12 md:grid-cols-[13rem_minmax(0,1fr)]">
            <span aria-hidden className="max-md:hidden" />
            <div className="grid min-w-0 gap-x-12 gap-y-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ol className="flex flex-col gap-8 text-[15px] leading-relaxed text-ink-2">
                <li className="grid grid-cols-[1.75rem_minmax(0,1fr)]">
                  <span className="font-mono text-sm text-muted">1</span>
                  <div className="min-w-0">
                    <p className="mb-3 font-medium text-ink">Start the stack</p>
                    <Commands lines={INSTALL} />
                  </div>
                </li>
                <li className="grid grid-cols-[1.75rem_minmax(0,1fr)]">
                  <span className="font-mono text-sm text-muted">2</span>
                  <p><span className="font-medium text-ink">Add a monitor</span> for <C>http://demo-service:9000/switch</C>, checking every <C>30 s</C>, open after <C>2</C>, resolve after <C>1</C>.</p>
                </li>
                <li className="grid grid-cols-[1.75rem_minmax(0,1fr)]">
                  <span className="font-mono text-sm text-muted">3</span>
                  <p><span className="font-medium text-ink">Break it.</span> Open <C>localhost:9000</C> and press Make it fail. Within about a minute the monitor is down, an incident is open and the email is in Mailpit.</p>
                </li>
                <li className="grid grid-cols-[1.75rem_minmax(0,1fr)]">
                  <span className="font-mono text-sm text-muted">4</span>
                  <p><span className="font-medium text-ink">Restore it.</span> The next passing check resolves the incident. Open it to read the timeline.</p>
                </li>
              </ol>
              <div>
                <table className="w-full text-left text-[15px]">
                  <caption className="caps mb-3 text-left">Once it’s up</caption>
                  <tbody>
                    {URLS.map((u) => (
                      <tr key={u.url} className="border-t border-line align-baseline">
                        <th scope="row" className="whitespace-nowrap py-3 pr-6 font-mono text-sm font-normal text-ink">{u.url}</th>
                        <td className="py-3 text-ink-2">{u.what}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-6 text-[15px] text-muted">
                  No Docker? The <a href={`${REPO}#local-development-without-docker`} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">README</a> runs
                  it with Python 3.12, Node 22, PostgreSQL and Redis.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Stack and tests. */}
        <section aria-labelledby="built" className="border-t border-line pb-24 pt-10">
          <SectionHead id="built" title="Built to be read">
            <p>
              269 backend tests run against real Postgres, Redis and a local HTTP target, including a four-thread race that must produce exactly one incident.
              Vitest covers the interface, and Playwright drives the whole lifecycle through the browser. CI also applies and rolls back every migration and scans the images.
            </p>
          </SectionHead>
          <dl className="readout grid grid-cols-2 gap-px border-y border-line bg-line md:grid-cols-4">
            {STACK.map((s) => (
              <div key={s.layer} className="bg-canvas py-4 pr-4">
                <dt className="caps">{s.layer}</dt>
                <dd className="mt-1.5 font-mono text-sm leading-6 text-ink">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Close. */}
        <section className="border-t border-line py-24">
          <p className="text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-balance">
            Clone it. Break it. Watch it recover.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <CopyButton text={INSTALL.join("\n")} label="Copy commands" size="md" variant="primary" />
            <a href={REPO} className={buttonClass("secondary", "md")}><GitHubIcon />Star on GitHub</a>
            <a href={doc("API")} className={buttonClass("ghost", "md")}>API docs</a>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-4 py-8 text-sm text-muted">
          <span className="inline-flex items-center gap-2"><LogoMark size={16} />MIT licence · © 2026 Parth Vasave</span>
          <nav aria-label="Project" className="flex flex-wrap gap-x-6 gap-y-2">
            <a href={REPO} className="transition-colors hover:text-ink">GitHub</a>
            <a href={doc("ARCHITECTURE")} className="transition-colors hover:text-ink">Architecture</a>
            <a href={doc("SECURITY")} className="transition-colors hover:text-ink">Security</a>
            <a href={doc("DEPLOYMENT")} className="transition-colors hover:text-ink">Deployment</a>
            <a href={doc("API")} className="transition-colors hover:text-ink">API</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
