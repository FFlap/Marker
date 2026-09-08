import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticated: false }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ userId: "viewer" }) }));
vi.mock("@/components/app-shell", async () => {
  const { Outlet } = await import("@tanstack/react-router");
  return { AppShell: Outlet };
});
vi.mock("@/pages/item-detail", () => ({
  ItemDetailPage: () => <input aria-label="Item draft" defaultValue="" />,
}));
vi.mock("@/hooks/use-marker-account", () => ({
  useMarkerAccount: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: false,
    accountReady: true,
    accountError: false,
  }),
}));
vi.mock("convex/react", () => ({
  useQuery: () => (mocks.authenticated ? { username: "viewer" } : undefined),
}));
vi.mock("@/pages/login", () => ({ LoginPage: () => <h1>Login screen</h1> }));
vi.mock("@/pages/extension-connect", () => ({
  ExtensionConnectPage: () => <h1>Extension connection</h1>,
}));
import { router } from "@/router";
afterEach(cleanup);
it.each([
  [false, "/extension/connect", "/login", "Login screen"],
  [
    true,
    "/login?next=%2Fextension%2Fconnect",
    "/extension/connect",
    "Extension connection",
  ],
  [
    true,
    "/setup?next=%2Fextension%2Fconnect",
    "/extension/connect",
    "Extension connection",
  ],
] as const)(
  "preserves the redirect destination from %s %s",
  async (authenticated, entry, destination, heading) => {
    vi.stubGlobal("scrollTo", vi.fn<() => void>());
    mocks.authenticated = authenticated;
    const testRouter = createRouter({
      routeTree: router.routeTree,
      history: createMemoryHistory({ initialEntries: [entry] }),
      scrollRestoration: false,
    });
    render(<RouterProvider router={testRouter} />);
    expect(
      await screen.findByRole("heading", { name: heading }),
    ).toBeInTheDocument();
    expect(testRouter.state.location.pathname).toBe(destination);
    expect(testRouter.state.location.search).toEqual(
      authenticated ? {} : { next: "/extension/connect" },
    );
  },
);

it("resets item drafts when navigating directly between items", async () => {
  mocks.authenticated = true;
  const testRouter = createRouter({
    routeTree: router.routeTree,
    history: createMemoryHistory({ initialEntries: ["/item/first"] }),
    scrollRestoration: false,
  });
  render(<RouterProvider router={testRouter} />);
  const input = await screen.findByRole("textbox", { name: "Item draft" });
  fireEvent.change(input, { target: { value: "first item edit" } });
  await testRouter.navigate({ to: "/item/$itemId", params: { itemId: "second" } });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Item draft" })).toHaveValue(""));
});
