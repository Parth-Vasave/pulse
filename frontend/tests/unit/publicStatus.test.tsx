import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PublicStatusPage from "@/app/status/[slug]/page";
import type { PublicStatus } from "@/lib/types";

const apiMock = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "sample" }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps the last successful refresh time when a later poll fails", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const first = new Date("2026-01-05T00:00:00Z");
  vi.setSystemTime(first);
  const status: PublicStatus = { overall_status: "operational", components: [], incidents: [] };
  apiMock.mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ ...status, overall_status: "degraded" })
    .mockRejectedValueOnce(new Error("Service unavailable"));

  render(<PublicStatusPage />);
  expect(screen.queryByText("Last refreshed")).not.toBeInTheDocument();
  await act(async () => { await Promise.resolve(); });

  const refreshTime = () => screen.getByText("Last refreshed").querySelector("time");
  expect(refreshTime()).toHaveAttribute("datetime", first.toISOString());
  expect(screen.getByText("All systems operational")).toBeInTheDocument();

  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  const refreshed = new Date(first.getTime() + 30_000).toISOString();
  expect(refreshTime()).toHaveAttribute("datetime", refreshed);
  expect(screen.getByText("Some systems are degraded")).toBeInTheDocument();

  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(refreshTime()).toHaveAttribute("datetime", refreshed);
  expect(screen.getByText("Some systems are degraded")).toBeInTheDocument();
  expect(screen.getByText(/couldn.t refresh/i)).toBeInTheDocument();
  expect(apiMock).toHaveBeenCalledTimes(3);
});
