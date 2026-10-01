import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserContext } from "@/components/AppShell";
import { Account } from "@/components/settings/Account";
import { ToastProvider } from "@/components/Toast";
import { ApiError } from "@/lib/api";

const apiMock = vi.fn();
const replace = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/hooks/useApi", () => ({ useApi: () => ({ data: [{ id: 1 }, { id: 2 }], loading: false, reload: vi.fn() }) }));

const refresh = vi.fn().mockResolvedValue(undefined);
function setup() {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
  return render(
    <ToastProvider>
      <UserContext.Provider value={{ user: { id: 1, email: "me@example.com", created_at: "2026-01-05T00:00:00Z" }, refresh }}>
        <Account />
      </UserContext.Provider>
    </ToastProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); replace.mockReset(); refresh.mockClear(); });

describe("Account settings", () => {
  it("shows the current email", () => {
    setup();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
  });

  it("changes email with the current password, then refreshes the user", async () => {
    apiMock.mockResolvedValue({});
    setup();
    await userEvent.type(screen.getByLabelText("New email address"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Current password", { selector: "#email_password" }), "pw-for-email");
    await userEvent.click(screen.getByRole("button", { name: "Update email" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith("/account/email", { method: "POST", json: { new_email: "new@example.com", current_password: "pw-for-email" } });
  });

  it("blocks mismatched new passwords without calling the API", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Current password", { selector: "#current_password" }), "old-password-1");
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "different-password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The new passwords don't match.");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("explains a wrong current password in plain words", async () => {
    apiMock.mockRejectedValue(new ApiError(403, "incorrect_password", "Current password is incorrect"));
    setup();
    await userEvent.type(screen.getByLabelText("Current password", { selector: "#current_password" }), "wrong-password");
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Your current password is incorrect.")).toBeInTheDocument();
  });

  it("submits a password change and tells the user other devices are signed out", async () => {
    apiMock.mockResolvedValue(undefined);
    setup();
    await userEvent.type(screen.getByLabelText("Current password", { selector: "#current_password" }), "old-password-1");
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText(/Other devices have been signed out/)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/account/password", { method: "POST", json: { current_password: "old-password-1", new_password: "brand-new-password" } });
  });

  it("requires a password before deleting, names what will be lost, then signs out", async () => {
    apiMock.mockResolvedValue(undefined);
    setup();
    expect(screen.getByText(/your 2 monitors/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete my account…" }));
    const confirm = screen.getByRole("button", { name: "Delete account" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Password", { selector: "#delete_password" }), "my-password-123");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(apiMock).toHaveBeenCalledWith("/account/delete", { method: "POST", json: { current_password: "my-password-123" } });
  });

  it("keeps the dialog open with an error if deletion is refused", async () => {
    apiMock.mockRejectedValue(new ApiError(403, "incorrect_password", "nope"));
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete my account…" }));
    await userEvent.type(screen.getByLabelText("Password", { selector: "#delete_password" }), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(await screen.findByText("Your current password is incorrect.")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
