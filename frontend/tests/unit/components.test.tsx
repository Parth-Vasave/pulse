import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui";
import { HealthBanner } from "@/components/HealthBanner";
import { Heartbeat } from "@/components/Heartbeat";
import { StatusBadge } from "@/components/StatusBadge";
import { Timeline } from "@/components/Timeline";

describe("StatusBadge", () => {
  it.each([["up", "UP"], ["down", "DOWN"], ["paused", "PAUSED"]] as const)("labels %s in text, not only color", (s, label) => {
    render(<StatusBadge status={s} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("Heartbeat", () => {
  it("describes results for assistive tech", () => {
    render(<Heartbeat results={[true, true, false]} />);
    expect(screen.getByRole("img", { name: "Last 3 checks: 2 passed, 1 failed" })).toBeInTheDocument();
  });
  it("handles no data", () => {
    render(<Heartbeat results={undefined} />);
    expect(screen.getByRole("img", { name: "No checks yet" })).toBeInTheDocument();
  });
});

describe("HealthBanner", () => {
  const base = { total_monitors: 4, healthy_monitors: 4, down_monitors: 0, paused_monitors: 0, active_incidents: 0, overall_uptime_24h: 99.9 };
  it("says all clear", () => {
    render(<HealthBanner s={base} />);
    expect(screen.getByRole("status")).toHaveTextContent("All systems operational");
  });
  it("calls out down monitors in words", () => {
    render(<HealthBanner s={{ ...base, healthy_monitors: 3, down_monitors: 1, active_incidents: 1 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 monitor is down");
  });
  it("handles empty accounts", () => {
    render(<HealthBanner s={{ ...base, total_monitors: 0, healthy_monitors: 0, overall_uptime_24h: null }} />);
    expect(screen.getByRole("status")).toHaveTextContent("No monitors yet");
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("Timeline", () => {
  it("renders events in order", () => {
    render(<Timeline events={[
      { occurred_at: "2026-01-01T12:31:04Z", event_type: "first_failure", message: "First failure" },
      { occurred_at: "2026-01-01T12:34:51Z", event_type: "incident_resolved", message: "Incident resolved" },
    ]} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("First failure");
    expect(items[1]).toHaveTextContent("Incident resolved");
  });
});

describe("ConfirmDialog", () => {
  it("wires confirm and cancel", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete API?" body="Gone forever." confirmLabel="Delete monitor" onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete monitor" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
