import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: undefined as { username: string; isPublic: boolean } | undefined,
  save: vi.fn<(args: unknown) => Promise<void>>(),
  navigate: vi.fn<() => void>(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.profile,
  useMutation: () => mocks.save,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("../../mobile/convex/_generated/api", () => ({
  api: { profiles: { me: "me", save: "save" } },
}));
vi.mock("@/hooks/use-avatar-upload", () => ({
  useAvatarUpload: () => ({ pending: false, upload: vi.fn<() => void>(), clear: vi.fn<() => void>() }),
}));
vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: () => null,
}));
import { ProfileEditPage } from "@/pages/profile-edit";

afterEach(cleanup);
it("loads profile defaults without overwriting edits on server updates", async () => {
  mocks.save.mockResolvedValue(undefined);
  const { rerender } = render(<ProfileEditPage />);
  mocks.profile = { username: "original", isPublic: true };
  rerender(<ProfileEditPage />);
  expect(screen.getByRole("textbox", { name: "Username" })).toHaveValue("original");
  fireEvent.change(screen.getByRole("textbox", { name: "Username" }), {
    target: { value: "draft_name" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Private/ }));
  mocks.profile = { username: "server_update", isPublic: true };
  rerender(<ProfileEditPage />);
  expect(screen.getByRole("textbox", { name: "Username" })).toHaveValue("draft_name");
  expect(screen.getByRole("button", { name: /^Private/ })).toHaveAttribute(
    "aria-pressed", "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
    username: "draft_name", isPublic: false,
  }));
});
