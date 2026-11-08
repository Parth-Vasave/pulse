import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyChannel } from "@/components/VerifyChannel";
import { ApiError } from "@/lib/api";

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

beforeEach(() => { apiMock.mockReset(); });
afterEach(() => { window.location.hash = ""; });

describe("Channel confirmation page", () => {
  it("does nothing until the recipient clicks (mail scanners open links too)", () => {
    window.location.hash = "#token=abc.def";
    render(<VerifyChannel />);
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send alerts to this address" })).toBeEnabled();
  });

  it("confirms with the token from the URL fragment", async () => {
    window.location.hash = "#token=abc.def";
    apiMock.mockResolvedValue({ status: "verified" });
    render(<VerifyChannel />);
    await userEvent.click(screen.getByRole("button", { name: "Send alerts to this address" }));
    expect(apiMock).toHaveBeenCalledWith("/public/verify-channel", { method: "POST", json: { token: "abc.def" } });
    expect(await screen.findByText("Address confirmed")).toBeInTheDocument();
  });

  it("shows the API's message for an expired or invalid link", async () => {
    window.location.hash = "#token=old";
    apiMock.mockRejectedValue(new ApiError(400, "invalid_token", "This confirmation link is invalid or has expired"));
    render(<VerifyChannel />);
    await userEvent.click(screen.getByRole("button", { name: "Send alerts to this address" }));
    expect(await screen.findByText("This confirmation link is invalid or has expired")).toBeInTheDocument();
  });

  it("explains a link with no token and can't submit", () => {
    render(<VerifyChannel />);
    expect(screen.getByText(/This link is incomplete/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send alerts to this address" })).toBeDisabled();
  });
});
