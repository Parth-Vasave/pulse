import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleNotice } from "@/components/ui";
import { ApiError, loadErrorMessage, safeNext } from "@/lib/api";

describe("safeNext", () => {
  it("returns a same-site path", () => {
    expect(safeNext("?next=%2Fmonitors%2F3%3Frange%3D7d")).toBe("/monitors/3?range=7d");
  });
  it.each(["", "?next=", "?next=https%3A%2F%2Fevil.example", "?next=%2F%2Fevil.example", "?next=%2F%5Cevil.example", "?next=dashboard"])(
    "falls back to the dashboard for %j", (search) => {
      expect(safeNext(search)).toBe("/dashboard");
    });
});

describe("loadErrorMessage", () => {
  it("says not found only for a 404", () => {
    expect(loadErrorMessage(new ApiError(404, "not_found", "Monitor not found"), "Gone.")).toBe("Gone.");
    expect(loadErrorMessage(new ApiError(500, "error", "Internal error"), "Gone.")).toBe("Internal error");
    expect(loadErrorMessage(new TypeError("fetch failed"), "Gone.")).toMatch(/connection/);
  });
});

describe("api() on 401", () => {
  const replace = vi.fn();
  const original = window.location;

  beforeEach(() => {
    vi.resetModules(); // the redirect guard is module state
    Object.defineProperty(window, "location", { configurable: true, value: { pathname: "/monitors/3", search: "?range=7d", replace } });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
    replace.mockReset();
    vi.unstubAllGlobals();
  });

  const respond = (status: number) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "unauthorized", message: "Not authenticated" } }), { status })));

  it("sends an expired session to login, then back to the same page", async () => {
    respond(401);
    const { api } = await import("@/lib/api");
    await expect(api("/monitors")).rejects.toMatchObject({ status: 401 });
    await expect(api("/dashboard/summary")).rejects.toMatchObject({ status: 401 });
    expect(replace).toHaveBeenCalledTimes(1); // several polls failing at once redirect once
    expect(replace).toHaveBeenCalledWith("/login?next=%2Fmonitors%2F3%3Frange%3D7d&expired=1");
  });

  it("leaves /auth 401s (wrong password, signed out) to the caller", async () => {
    respond(401);
    const { api } = await import("@/lib/api");
    await expect(api("/auth/login", { method: "POST", json: {} })).rejects.toMatchObject({ status: 401 });
    await expect(api("/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("StaleNotice", () => {
  it("renders nothing while refreshes succeed", () => {
    const { container } = render(<StaleNotice error={undefined} updatedAt={Date.now()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("says the data on screen is stale", () => {
    render(<StaleNotice error={new Error("offline")} updatedAt={Date.now() - 125_000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t refresh. Showing data from 2m ago.");
  });
});
