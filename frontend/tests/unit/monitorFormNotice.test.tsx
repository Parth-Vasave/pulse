import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonitorForm } from "@/components/MonitorForm";

describe("MonitorForm", () => {
  it("warns on edit that changing the URL or method resets status and closes incidents", () => {
    render(<MonitorForm editing submitLabel="Save changes" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/resets this monitor’s status and closes any open incident/)).toBeInTheDocument();
  });
  it("does not show that warning when creating", () => {
    render(<MonitorForm submitLabel="Create monitor" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/closes any open incident/)).not.toBeInTheDocument();
    expect(screen.getByText(/Private and internal addresses are blocked/)).toBeInTheDocument();
  });
});
