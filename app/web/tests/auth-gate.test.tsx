import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userId: "first" }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ userId: mocks.userId }) }));
vi.mock("@/hooks/use-marker-account", () => ({
  useMarkerAccount: () => ({ isAuthenticated: true, isLoading: false, accountReady: true, accountError: false }),
}));
vi.mock("convex/react", () => ({ useQuery: () => ({ username: mocks.userId }) }));
vi.mock("@tanstack/react-router", () => ({
  Navigate: () => null,
  useSearch: () => ({}),
  useRouterState: () => ({ pathname: "/profile/edit", searchStr: "" }),
}));
import { AuthGate } from "@/components/auth-gate";

afterEach(cleanup);
it("resets protected drafts on a direct authenticated account switch", () => {
  const child = <input aria-label="Profile draft" defaultValue="" />;
  const { rerender } = render(<AuthGate>{child}</AuthGate>);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "first account draft" } });
  rerender(<AuthGate>{child}</AuthGate>);
  expect(screen.getByRole("textbox")).toHaveValue("first account draft");
  mocks.userId = "second";
  rerender(<AuthGate>{child}</AuthGate>);
  expect(screen.getByRole("textbox")).toHaveValue("");
});
