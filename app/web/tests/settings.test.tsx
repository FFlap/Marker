import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  stored: { defaultView: "list" },
  save: vi.fn<() => Promise<void>>(),
}));
vi.mock("convex/react", () => ({ useQuery: () => mocks.stored, useMutation: () => mocks.save }));
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: vi.fn<() => Promise<void>>() }) }));
vi.mock("../../mobile/convex/_generated/api", () => ({ api: { settings: { getSettings: "get", setSettings: "set" } } }));
vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: () => null,
  SectionHeader: () => null,
}));
import { SettingsPage } from "@/pages/settings";
afterEach(cleanup);
it("follows server preferences after an optimistic save completes", async () => {
  mocks.save.mockImplementation(async () => { mocks.stored = { defaultView: "posters" }; });
  const { rerender } = render(<SettingsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Posters" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Posters" })).toBeEnabled());
  mocks.stored = { defaultView: "list" };
  rerender(<SettingsPage />);
  expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
});
