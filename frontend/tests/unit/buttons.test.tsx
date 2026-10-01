import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/Toast";
import { Button, CopyButton, IconButton, SegmentedControl, Toggle } from "@/components/ui";

describe("Button", () => {
  it("is disabled and marked busy while loading, so it can't be double-submitted", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("type", "button");
  });
});

describe("IconButton", () => {
  it("has an accessible name and fires on click", async () => {
    const onClick = vi.fn();
    render(<IconButton label="Delete API" onClick={onClick}>x</IconButton>);
    await userEvent.click(screen.getByRole("button", { name: "Delete API" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Toggle", () => {
  it("exposes switch semantics and reports the new value", async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Enable alerts" />);
    const sw = screen.getByRole("switch", { name: "Enable alerts" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("SegmentedControl", () => {
  it("marks the selected option and changes selection", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Range" value="24h" onChange={onChange} options={[{ value: "1h", label: "1 hour" }, { value: "24h", label: "24 hours" }]} />);
    expect(screen.getByRole("button", { name: "24 hours" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "1 hour" }));
    expect(onChange).toHaveBeenCalledWith("1h");
  });
});

describe("CopyButton", () => {
  it("copies and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyButton text="apm_secret" label="Copy key" />);
    await userEvent.click(screen.getByRole("button", { name: /Copy key/ }));
    expect(writeText).toHaveBeenCalledWith("apm_secret");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});

describe("Toast", () => {
  function Demo() {
    const t = useToast();
    return <><button onClick={() => t.success("Saved")}>ok</button><button onClick={() => t.error("Nope")}>fail</button></>;
  }
  it("announces success politely and errors assertively", async () => {
    render(<ToastProvider><Demo /></ToastProvider>);
    await userEvent.click(screen.getByText("ok"));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    await userEvent.click(screen.getByText("fail"));
    expect(screen.getByRole("alert")).toHaveTextContent("Nope");
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});
