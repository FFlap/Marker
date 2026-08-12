import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn<(args: unknown) => Promise<void>>(),
  eligible: [
    { _id: "eligible-tv", title: "Severance", mediaType: "tv", isAnime: false },
    { _id: "eligible-anime", title: "Frieren", mediaType: "tv", isAnime: true },
    {
      _id: "eligible-movie",
      title: "Arrival",
      mediaType: "movie",
      isAnime: false,
    },
  ],
  remove: vi.fn<(args: unknown) => Promise<void>>(),
  reorder: vi.fn<(args: unknown) => Promise<void>>(),
}));

vi.mock("convex/react", () => ({
  useMutation: (ref: string) => {
    if (ref === "profileFavorites.add") return mocks.add;
    if (ref === "profileFavorites.remove") return mocks.remove;
    if (ref === "profileFavorites.reorder") return mocks.reorder;
    throw new Error(`Unexpected mutation: ${ref}`);
  },
  useQuery: (ref: string) => {
    if (ref === "profileFavorites.eligible") return mocks.eligible;
    throw new Error(`Unexpected query: ${ref}`);
  },
}));

vi.mock("../../mobile/convex/_generated/api", () => ({
  api: {
    profileFavorites: {
      add: "profileFavorites.add",
      eligible: "profileFavorites.eligible",
      remove: "profileFavorites.remove",
      reorder: "profileFavorites.reorder",
    },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

import { ProfileFavorites } from "@/components/profile-favorites";

afterEach(cleanup);

describe("profile favorites", () => {
  beforeEach(() => vi.clearAllMocks());
  const favorites = [
    {
      _id: "favorite-tv",
      title: "The Office",
      mediaType: "tv" as const,
      isAnime: false,
      rank: 1,
    },
    {
      _id: "favorite-anime",
      title: "One Piece",
      mediaType: "tv" as const,
      isAnime: true,
      rank: 2,
    },
    {
      _id: "favorite-movie",
      title: "Heat",
      mediaType: "movie" as const,
      isAnime: false,
      rank: 3,
    },
  ];

  it("separates anime from TV shows and exposes keyboard-ready reorder controls", () => {
    render(<ProfileFavorites favorites={favorites} />);

    expect(
      screen.getByRole("heading", { name: "TV Shows" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Anime" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Movies" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drag One Piece" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+ArrowUp Alt+ArrowDown",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open actions for One Piece" }));
    expect(screen.getByRole("button", { name: "Move up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move down" })).toBeInTheDocument();
  });

  it("keeps anime out of the TV picker", () => {
    render(<ProfileFavorites favorites={favorites} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Add favorite TV show" }),
    );
    expect(
      screen.getByRole("heading", { name: "Add TV show" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Severance" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Frieren" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Add favorite anime" }));
    expect(
      screen.getByRole("heading", { name: "Add anime" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Frieren" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Severance" }),
    ).not.toBeInTheDocument();
  });

  it("persists favorite add, remove, and reorder actions", async () => {
    const twoMovies = [
      ...favorites,
      { _id: "favorite-movie-2", title: "Arrival", mediaType: "movie" as const, isAnime: false, rank: 4 },
    ];
    render(<ProfileFavorites favorites={twoMovies} />);

    fireEvent.click(screen.getByRole("button", { name: "Open actions for Heat" }));
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(mocks.reorder).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Open actions for The Office" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from favorites" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ itemId: "favorite-tv" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Add favorite TV show" }));
    fireEvent.click(screen.getByRole("button", { name: "Severance" }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith({ itemId: "eligible-tv" }));
  });
});
