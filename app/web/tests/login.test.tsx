import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const signIn = {
    status: null as string | null,
    create: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    password: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    finalize: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    reset: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    sso: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    resetPasswordEmailCode: {
      sendCode: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
      verifyCode: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
      submitPassword: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    },
    mfa: {
      sendEmailCode: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
      verifyEmailCode: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    },
  };
  const signUp = {
    status: null as string | null,
    missingFields: [] as string[],
    password: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    finalize: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    reset: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    update: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    verifications: {
      sendEmailCode: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
      verifyEmailCode: vi.fn<(...args: unknown[]) => Promise<{ error: unknown | null }>>(),
    },
  };
  return { signIn, signUp };
});

vi.mock("@clerk/react", () => {
  return {
    useSignIn: () => ({ signIn: mocks.signIn }),
    useSignUp: () => ({ signUp: mocks.signUp }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn<() => void>(),
  useSearch: () => ({}),
}));

import { LoginPage } from "@/pages/login";

afterEach(cleanup);

describe("login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signIn.status = null;
    mocks.signUp.status = null;
    mocks.signUp.missingFields = [];
    for (const mock of [
      mocks.signIn.create,
      mocks.signIn.finalize,
      mocks.signIn.resetPasswordEmailCode.sendCode,
      mocks.signIn.resetPasswordEmailCode.verifyCode,
      mocks.signIn.resetPasswordEmailCode.submitPassword,
    ]) {
      mock.mockResolvedValue({ error: null });
    }
  });
  it("opens with clear login and sign-up choices", () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: "Welcome to Marker." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("reveals the custom Clerk account-creation form", () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(
      screen.getByRole("heading", { name: "Make it yours." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeInTheDocument();
  });

  it("resets a password through Clerk and signs out other sessions", async () => {
    mocks.signIn.resetPasswordEmailCode.verifyCode.mockImplementation(async () => {
      mocks.signIn.status = "needs_new_password";
      return { error: null };
    });
    mocks.signIn.resetPasswordEmailCode.submitPassword.mockImplementation(async () => {
      mocks.signIn.status = "complete";
      return { error: null };
    });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "viewer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await waitFor(() =>
      expect(mocks.signIn.create).toHaveBeenCalledWith({
        identifier: "viewer@example.com",
      }),
    );
    expect(mocks.signIn.resetPasswordEmailCode.sendCode).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await waitFor(() =>
      expect(mocks.signIn.resetPasswordEmailCode.verifyCode).toHaveBeenCalledWith({
        code: "123456",
      }),
    );

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() =>
      expect(
        mocks.signIn.resetPasswordEmailCode.submitPassword,
      ).toHaveBeenCalledWith({
        password: "new-password",
        signOutOfOtherSessions: true,
      }),
    );
    expect(mocks.signIn.finalize).toHaveBeenCalled();
  });

  it.each([
    ["verification code expired", "That reset code is invalid or expired."],
    ["password is too weak", "Choose a stronger password with at least eight characters."],
    ["too many attempts; throttled", "Too many reset attempts. Wait a moment, then try again."],
  ])("shows an inline recovery error for %s", async (message, expected) => {
    mocks.signIn.create.mockResolvedValueOnce({ error: new Error(message) });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.change(screen.getByLabelText("Email or username"), {
      target: { value: "viewer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
  });
});
