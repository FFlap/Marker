import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { localDateKey, useLocalToday } from "@/hooks/use-local-today";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Run under UTC and America/Edmonton to cover ordinary, 23-hour and 25-hour days.
it.each([
  [2, 8],
  [10, 1],
])("refreshes at local midnight through DST (%s/%s)", (month, day) => {
  vi.useFakeTimers();
  const start = new Date(2026, month, day);
  const next = new Date(2026, month, day + 1);
  vi.setSystemTime(start);
  const { result, unmount } = renderHook(useLocalToday);
  expect(result.current).toBe(localDateKey(start));
  act(() => {
    vi.advanceTimersByTime(next.getTime() - start.getTime() - 1);
  });
  expect(result.current).toBe(localDateKey(start));
  act(() => {
    vi.advanceTimersByTime(101);
  });
  expect(result.current).toBe(localDateKey(next));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes on focus and visible resume after the clock changes and removes listeners", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 10, 12));
  const focusCleanup = vi.spyOn(window, "removeEventListener");
  const visibilityCleanup = vi.spyOn(document, "removeEventListener");
  const { result, unmount } = renderHook(useLocalToday);
  vi.setSystemTime(new Date(2026, 9, 12, 12));
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(result.current).toBe("2026-10-12");
  expect(vi.getTimerCount()).toBe(1);
  vi.setSystemTime(new Date(2026, 9, 14, 12));
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(result.current).toBe("2026-10-12");
  visibility.mockReturnValue("visible");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(result.current).toBe("2026-10-14");
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(focusCleanup).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(visibilityCleanup).toHaveBeenCalledWith(
    "visibilitychange",
    expect.any(Function),
  );
});

it("keeps one subscription through Strict Mode and unrelated renders", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 10, 12));
  const addFocus = vi.spyOn(window, "addEventListener");
  const { result, rerender, unmount } = renderHook(useLocalToday, {
    wrapper: StrictMode,
  });
  const subscriptions = addFocus.mock.calls.filter(([type]) => type === "focus").length;
  expect(vi.getTimerCount()).toBe(1);
  rerender();
  expect(addFocus.mock.calls.filter(([type]) => type === "focus")).toHaveLength(subscriptions);
  vi.setSystemTime(new Date(2026, 9, 11, 12));
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(result.current).toBe("2026-10-11");
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(vi.getTimerCount()).toBe(0);
});
