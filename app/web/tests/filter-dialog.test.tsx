import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterDialog, type LibraryFilters } from "@/components/filter-dialog";

afterEach(cleanup);

describe("library filter dialog", () => {
  it("uses a dialog and applies status filters", () => {
    const onChange = vi.fn<(next: LibraryFilters) => void>();
    render(
      <FilterDialog
        value={{ media: "all", minimum: 0, status: "all", tags: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Watching" }));
    expect(onChange).toHaveBeenCalledWith({
      media: "all",
      minimum: 0,
      status: "watching",
      tags: [],
    });
  });

  it("applies the anime media filter", () => {
    const onChange = vi.fn<(next: LibraryFilters) => void>();
    render(
      <FilterDialog
        value={{ media: "all", minimum: 0, status: "all", tags: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByRole("button", { name: "Anime" }));
    expect(onChange).toHaveBeenCalledWith({
      media: "anime",
      minimum: 0,
      status: "all",
      tags: [],
    });
  });

  it("applies tag and 3-star minimum filters", () => {
    const onChange = vi.fn<(next: LibraryFilters) => void>();
    const value: LibraryFilters = { media: "all", minimum: 0, status: "all", tags: [] };
    const view = render(<FilterDialog value={value} onChange={onChange} availableTags={["Anime"]} />);
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByRole("button", { name: "3 stars and up" }));
    for (const rating of [5, 4, 3, 2, 1]) {
      const option = screen.getByRole("button", { name: `${rating} stars and up` });
      expect(option.firstElementChild?.tagName.toLowerCase()).toBe("svg");
      expect(option).toHaveTextContent(String(rating));
    }
    expect(screen.queryByRole("button", { name: "9+" })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ ...value, minimum: 3 });
    view.rerender(<FilterDialog value={{ ...value, minimum: 3 }} onChange={onChange} availableTags={["Anime"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Tag: Anime" }));
    expect(onChange).toHaveBeenCalledWith({ ...value, minimum: 3, tags: ["Anime"] });
  });
});
