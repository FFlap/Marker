import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  loadMore: vi.fn<(count: number) => void>(),
}));
vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({
    results: [],
    status: "CanLoadMore",
    loadMore: mocks.loadMore,
  }),
  useConvexAuth: () => ({ isAuthenticated: false }),
  useQuery: (_ref: unknown, args: unknown) =>
    args === "skip"
      ? undefined
      : {
          tag: "Favorites",
          titles: [],
          contributorCount: 1,
          nextCursor: "next-page",
        },
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ tag: "Favorites", username: "viewer" }),
  useSearch: () => ({}),
  Link: ({
    children,
    search,
  }: {
    children: ReactNode;
    search?: { cursor?: string };
  }) => <a href={`?cursor=${search?.cursor ?? ""}`}>{children}</a>,
}));
vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: () => null,
  SectionHeader: () => null,
}));
import { TagsPage } from "@/pages/tags";
import { PublicTagPage } from "@/pages/public-tag";
import { PublicUserTagPage } from "@/pages/public-user-tag";
afterEach(cleanup);
it("loads the next private tag page", () => {
  render(<TagsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Load more tags" }));
  expect(mocks.loadMore).toHaveBeenCalledWith(100);
});
it.each([PublicTagPage, PublicUserTagPage])(
  "forwards the public collection cursor in navigation",
  (Page) => {
    render(<Page />);
    expect(screen.getByRole("link", { name: "Next titles" })).toHaveAttribute(
      "href",
      "?cursor=next-page",
    );
  },
);
