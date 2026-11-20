import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import Dashboard from "@/app/(app)/dashboard/page";
import { ToastProvider } from "@/components/Toast";
import type { Monitor } from "@/lib/types";

const apiMock = vi.fn();
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock("@/components/PulsarPlot", () => ({
  PulsarPlot: ({ monitors }: { monitors: Monitor[] }) => (
    <ul aria-label="Plotted monitors">{monitors.map((monitor) => <li key={monitor.id}>{monitor.name}</li>)}</ul>
  ),
}));

it("filters the monitor table by name, preserving sort order and the plot", async () => {
  const upstream: Monitor = {
    id: 1, name: "Catalog Writer", url: "https://example.com/writer", method: "GET",
    headers: {}, body: null, expected_status_code: 200, timeout_seconds: 5,
    interval_seconds: 60, response_time_threshold_ms: null, failure_threshold: 3,
    recovery_threshold: 2, check_retries: 1, assertions: [], enabled: true,
    show_on_status_page: false, status: "up", last_checked_at: null,
    last_response_time_ms: null, uptime_24h: null, display_status: "up",
  };
  const monitors: Monitor[] = [
    upstream,
    { ...upstream, id: 2, name: "Search API", url: "https://example.com/catalog" },
    { ...upstream, id: 3, name: "catalog Cache", status: "down", display_status: "down" },
  ];
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/monitors") return monitors;
    if (path === "/monitors/traces") return {};
    if (path === "/dashboard/summary") {
      return { total_monitors: 3, healthy_monitors: 2, down_monitors: 1, paused_monitors: 0, active_incidents: 1, overall_uptime_24h: 98 };
    }
    throw new Error(`Unexpected API path ${path}`);
  });

  render(<ToastProvider><Dashboard /></ToastProvider>);
  await screen.findByRole("link", { name: "Catalog Writer" });
  const filter = screen.getByRole("searchbox", { name: "Filter monitors by name" });
  const monitorNames = () => within(screen.getByRole("table", { name: "Monitors" })).getAllByRole("link")
    .filter((link) => !link.getAttribute("aria-label"))
    .map((link) => link.textContent);

  await userEvent.type(filter, "CaTaLoG");
  expect(monitorNames()).toEqual(["catalog Cache", "Catalog Writer"]);
  expect(within(screen.getByRole("list", { name: "Plotted monitors" })).getAllByRole("listitem")).toHaveLength(3);

  await userEvent.type(filter, "-missing");
  expect(screen.getByText("No monitors match your filter")).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "Monitors" })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(filter).toHaveValue("");
  expect(filter).toHaveFocus();
  expect(monitorNames()).toEqual(["catalog Cache", "Catalog Writer", "Search API"]);
});
