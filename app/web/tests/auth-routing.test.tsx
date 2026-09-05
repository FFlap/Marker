import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-marker-account", () => ({
  useMarkerAccount: () => ({ isAuthenticated: false, isLoading: false, accountReady: true, accountError: false }),
}));
vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/pages/login", () => ({ LoginPage: () => <h1>Login screen</h1> }));
import { router } from "@/router";
afterEach(cleanup);
it("redirects an anonymous deep link once and preserves its destination", async () => {
  router.update({ history: createMemoryHistory({ initialEntries: ["/extension/connect"] }) });
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "Login screen" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.search).toEqual({ next: "/extension/connect" });
});
