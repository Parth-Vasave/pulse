import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/Toast";
import { Button, CopyButton, IconButton, SegmentedControl, Toggle } from "@/components/ui";

afterEach(() => {
  vi.useRealTimers();
});

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
    return (
      <>
        <button onClick={() => t.success("Saved")}>ok</button>
        <button onClick={() => t.success("Second")}>ok2</button>
        <button onClick={() => t.success("Third")}>ok3</button>
        <button onClick={() => t.success("Fourth")}>ok4</button>
        <button onClick={() => t.success("Fifth")}>ok5</button>
        <button onClick={() => t.success("Sixth")}>ok6</button>
        <button onClick={() => t.error("Nope")}>fail</button>
      </>
    );
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

  it("stays visible while keyboard focus is inside and resumes with remaining time on blur", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Demo /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    const toast = screen.getByRole("status");
    const dismissButton = screen.getByRole("button", { name: "Dismiss" });

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.focus(dismissButton);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(toast).toBeInTheDocument();

    fireEvent.blur(dismissButton, { relatedTarget: screen.getByText("ok") });

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays visible while mouse or pen pointer is hovering, ignores touch sticky hover, and resumes on leave", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Demo /></ToastProvider>);
    fireEvent.click(screen.getByText("fail"));
    const toast = screen.getByRole("alert");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.pointerEnter(toast, { pointerType: "pen", pointerId: 1 });

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Nope");

    fireEvent.pointerLeave(toast, { pointerType: "pen", pointerId: 1 });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerEnter(toast, { pointerType: "touch", pointerId: 2 });

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Nope");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tracks hover pointer IDs so one pointer leaving does not clear another active hover pointer", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Demo /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    const toast = screen.getByRole("status");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerEnter(toast, { pointerType: "mouse", pointerId: 10 });
    fireEvent.pointerEnter(toast, { pointerType: "pen", pointerId: 20 });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.pointerLeave(toast, { pointerType: "pen", pointerId: 20 });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    fireEvent.pointerLeave(toast, { pointerType: "mouse", pointerId: 10 });

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("handles overlapping pointer and keyboard interactions and manual dismissal while paused", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Demo /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    const toast = screen.getByRole("status");
    const dismissButton = screen.getByRole("button", { name: "Dismiss" });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerEnter(toast, { pointerType: "mouse", pointerId: 1 });
    fireEvent.focus(dismissButton);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.pointerLeave(toast, { pointerType: "mouse", pointerId: 1 });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    fireEvent.blur(dismissButton, { relatedTarget: screen.getByText("ok") });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    fireEvent.focus(dismissButton);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(dismissButton);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps timers independent across concurrent notifications", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Demo /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    fireEvent.click(screen.getByText("ok2"));

    const toasts = screen.getAllByRole("status");
    expect(toasts).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerEnter(toasts[0], { pointerType: "mouse", pointerId: 1 });

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Second")).not.toBeInTheDocument();

    fireEvent.pointerLeave(toasts[0], { pointerType: "mouse", pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("does not evict a focused or hovered toast when a fifth toast arrives, and promotes pending backlog items one slot at a time in StrictMode", () => {
    vi.useFakeTimers();
    render(
      <StrictMode>
        <ToastProvider><Demo /></ToastProvider>
      </StrictMode>,
    );
    fireEvent.click(screen.getByText("ok"));
    fireEvent.click(screen.getByText("ok2"));
    fireEvent.click(screen.getByText("ok3"));
    fireEvent.click(screen.getByText("ok4"));

    const dismissButtons = screen.getAllByRole("button", { name: "Dismiss" });
    fireEvent.focus(dismissButtons[0]);

    fireEvent.click(screen.getByText("ok5"));

    expect(screen.getAllByRole("status")).toHaveLength(4);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Second")).not.toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
    expect(screen.getByText("Fourth")).toBeInTheDocument();
    expect(screen.getByText("Fifth")).toBeInTheDocument();

    // Mark all 4 visible toasts active (Saved is focused; Third, Fourth, Fifth are hovered)
    const activeToasts = screen.getAllByRole("status");
    fireEvent.pointerEnter(activeToasts[1], { pointerType: "mouse", pointerId: 11 });
    fireEvent.pointerEnter(activeToasts[2], { pointerType: "pen", pointerId: 12 });
    fireEvent.pointerEnter(activeToasts[3], { pointerType: "mouse", pointerId: 13 });

    // Enqueue two backlog items while all 4 visible slots are active
    fireEvent.click(screen.getByText("ok6"));
    fireEvent.click(screen.getByText("fail"));
    expect(screen.getAllByRole("status")).toHaveLength(4);
    expect(screen.queryByText("Sixth")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Unhovering one toast frees one slot: only the first pending toast ("Sixth") must be promoted,
    // and "Sixth" must remain visible instead of being immediately evicted by the second pending toast ("Nope")
    fireEvent.pointerLeave(activeToasts[1], { pointerType: "mouse", pointerId: 11 });
    expect(screen.queryByText("Third")).not.toBeInTheDocument();
    expect(screen.getByText("Sixth")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Unhovering a second active toast promotes the next pending toast ("Nope") in FIFO order
    fireEvent.pointerLeave(activeToasts[2], { pointerType: "pen", pointerId: 12 });
    expect(screen.queryByText("Fourth")).not.toBeInTheDocument();
    expect(screen.getByText("Sixth")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Nope");
  });
});
