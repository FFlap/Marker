import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requests: [
    { username: "alice", followerCount: 1 },
    { username: "bob", followerCount: 2 },
  ],
  respond: vi.fn<(args: { username: string; accept: boolean }) => Promise<void>>(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.respond,
  useQuery: () => mocks.requests,
}));

vi.mock("../../mobile/convex/_generated/api", () => ({
  api: {
    profiles: {
      followRequests: "profiles.followRequests",
      respondToFollow: "profiles.respondToFollow",
    },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to: _to, params: _params, ...props }: React.ComponentProps<"a"> & {
    to?: string;
    params?: unknown;
  }) => <a {...props}>{children}</a>,
}));

import { FollowRequestList } from "@/components/follow-request-list";

afterEach(cleanup);

describe("follow request list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps each request disabled until its own response finishes", async () => {
    const resolvers = new Map<string, () => void>();
    mocks.respond.mockImplementation(
      ({ username }) =>
        new Promise<void>((resolve) => {
          resolvers.set(username, resolve);
        }),
    );
    render(<FollowRequestList />);

    fireEvent.click(screen.getByRole("button", { name: "Accept @alice" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept @bob" }));
    expect(screen.getByRole("button", { name: "Accept @alice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept @bob" })).toBeDisabled();

    await act(async () => resolvers.get("alice")?.());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Accept @alice" })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "Accept @bob" })).toBeDisabled();

    await act(async () => resolvers.get("bob")?.());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Accept @bob" })).toBeEnabled(),
    );
  });
});
