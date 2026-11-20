import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import Incidents from "@/app/(app)/incidents/page";
import type { Incident } from "@/lib/types";

const apiMock = vi.fn();
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

it("names the populated active and resolved incident tables separately", async () => {
  const active: Incident = {
    id: 1, monitor_id: 10, monitor_name: "Catalog API",
    started_at: "2026-01-05T00:00:00Z", resolved_at: null, status: "open",
    failure_count: 3, recovery_count: 0, reason: "Timeout", duration_seconds: 60,
  };
  const resolved: Incident = {
    ...active, id: 2, monitor_id: 20, monitor_name: "Search API",
    resolved_at: "2026-01-05T00:01:00Z", status: "resolved", recovery_count: 2,
  };
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/incidents?status=open") return [active];
    if (path === "/incidents?status=resolved&limit=50") return [resolved];
    throw new Error(`Unexpected API path ${path}`);
  });

  render(<Incidents />);

  const activeTable = within(await screen.findByRole("table", { name: "Active incidents" }));
  const resolvedTable = within(await screen.findByRole("table", { name: "Resolved incidents" }));
  expect(activeTable.getByRole("link", { name: "Catalog API" })).toHaveAttribute("href", "/incidents/1");
  expect(resolvedTable.getByRole("link", { name: "Search API" })).toHaveAttribute("href", "/incidents/2");
  expect(activeTable.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(resolvedTable.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
});
