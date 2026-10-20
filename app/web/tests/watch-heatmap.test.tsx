import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WatchHeatmap } from "@/components/watch-heatmap";

let width = 109;
let onResize: () => void;
const disconnect = vi.fn<() => void>();

beforeEach(() => {
  width = 109;
  disconnect.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("supports touch selection, reactive counts, and one keyboard tab stop", () => {
  const view = render(
    <WatchHeatmap
      days={[{ date: "2026-10-09", episodes: 2 }]}
      today="2026-10-10"
    />,
  );
  const day = screen.getByRole("button", { name: "2 episodes on Oct 9, 2026" });
  expect(
    screen.getAllByRole("button").filter((button) => button.tabIndex === 0),
  ).toHaveLength(1);
  fireEvent.click(day);
  expect(screen.getByText("2 episodes · Oct 9, 2026")).toBeInTheDocument();
  expect(day.tabIndex).toBe(0);
  view.rerender(
    <WatchHeatmap
      days={[{ date: "2026-10-09", episodes: 5 }]}
      today="2026-10-10"
    />,
  );
  expect(screen.getByText("5 episodes · Oct 9, 2026")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "5 episodes on Oct 9, 2026" }),
  ).toBe(day);
  view.rerender(<WatchHeatmap days={[]} today="2026-10-10" />);
  expect(screen.getByText("0 episodes · Oct 9, 2026")).toBeInTheDocument();
});

it("moves keyboard focus by day and week, and clamps navigation at both ends", () => {
  render(<WatchHeatmap days={[]} today="2026-10-07" />);
  const today = screen.getByRole("button", {
    name: "0 episodes on Oct 7, 2026",
  });
  act(() => today.focus());
  fireEvent.keyDown(today, { key: "ArrowUp" });
  expect(
    screen.getByRole("button", { name: "0 episodes on Oct 6, 2026" }),
  ).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(
    screen.getByRole("button", { name: "0 episodes on Sep 29, 2026" }),
  ).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(today).toHaveFocus();
  fireEvent.keyDown(today, { key: "ArrowDown" });
  expect(today).toHaveFocus();
  fireEvent.keyDown(today, { key: "Home" });
  expect(screen.getAllByRole("button")[0]).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(screen.getAllByRole("button")[0]).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(today).toHaveFocus();
  expect(
    screen.getAllByRole("button").filter((button) => button.tabIndex === 0),
  ).toEqual([today]);
});

it("keeps a usable tab stop after resize or midnight removes the selected day", () => {
  const view = render(<WatchHeatmap days={[]} today="2026-10-10" />);
  fireEvent.click(screen.getAllByRole("button")[0]!);
  width = 13;
  act(() => onResize());
  expect(screen.getByText("0 episodes in the last 1 week")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "0 episodes on Oct 10, 2026" }).tabIndex,
  ).toBe(0);
  fireEvent.click(screen.getAllByRole("button")[0]!);
  view.rerender(<WatchHeatmap days={[]} today="2026-10-11" />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "0 episodes on Oct 11, 2026" }).tabIndex,
  ).toBe(0);
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
