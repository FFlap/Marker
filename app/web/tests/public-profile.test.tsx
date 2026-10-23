import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClientWriteSession } from "@marker/shared/clientOperations";
import { OperationSessionContext } from "@/hooks/operation-session";

vi.unmock("../src/hooks/operation-session");

const mocks = vi.hoisted(() => ({
  sessionId: "first",
  username: "alice",
  follow: vi.fn<(args: { username: string }) => Promise<void>>(),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ sessionId: mocks.sessionId }),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ username: mocks.username }),
  useNavigate: () => vi.fn<() => Promise<void>>(),
  useRouter: () => ({ history: { canGoBack: () => false } }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.follow,
  useQuery: () => ({
    profile: {
      username: mocks.username,
      isPublic: true,
      followerCount: 0,
      followingCount: 0,
    },
    relationship: "none",
    publicTags: [],
  }),
}));

import { PublicProfilePage } from "@/pages/public-profile";

afterEach(cleanup);

it("resets follow controls on session changes without settling the new account's request", async () => {
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  mocks.follow
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        }),
    );
  const first = new ClientWriteSession("first", () => mocks.sessionId);
  const second = new ClientWriteSession("second", () => mocks.sessionId);
  const view = render(
    <OperationSessionContext value={first}>
      <PublicProfilePage />
    </OperationSessionContext>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Follow" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

  mocks.sessionId = "second";
  view.rerender(
    <OperationSessionContext value={second}>
      <PublicProfilePage />
    </OperationSessionContext>,
  );
  expect(screen.getByRole("button", { name: "Follow" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Follow" }));

  await act(async () => {
    finishFirst();
  });
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await act(async () => {
    finishSecond();
  });
  expect(screen.getByRole("button", { name: "Follow" })).toBeEnabled();
  expect(mocks.follow).toHaveBeenCalledTimes(2);
});
