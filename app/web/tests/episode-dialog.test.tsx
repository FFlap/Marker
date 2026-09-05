import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn<() => Promise<void>>() }));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.save,
  useQuery: () => [],
}));
vi.mock("../../mobile/convex/_generated/api", () => ({
  api: {
    library: {
      episodes: { setEpisodeState: "save" },
      items: { listTagSuggestions: "tags" },
    },
  },
}));
import { EpisodeDialog } from "@/components/episode-dialog";

afterEach(cleanup);

it("locks episode controls during autosave and restores them after failure", async () => {
  let rejectSave!: (error: Error) => void;
  mocks.save.mockReturnValue(
    new Promise((_, reject) => {
      rejectSave = reject;
    }),
  );
  render(
    <EpisodeDialog
      episode={{
        itemId: "item",
        title: "Show",
        seasonName: "Season 1",
        season: 1,
        episode: 1,
        name: "Pilot",
        rating: 4,
        watched: true,
      }}
    >
      <button type="button">Open</button>
    </EpisodeDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  fireEvent.click(screen.getByRole("radio", { name: "Rate 3 stars" }));
  expect(screen.getByRole("radio", { name: "Rate 4 stars" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => {
    rejectSave(new Error("offline"));
  });
  expect(screen.getByRole("radio", { name: "Rate 2 stars" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Rate 4 stars" })).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn’t update this episode",
  );
});
