import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPersistedWatchUrl, Popup } from "./main";

type StorageListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string,
) => void;

let storageListener: StorageListener;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === "sync/status" || message.type === "sync/signOut") return { signedIn: false };
    if (message.type.startsWith("bookmark/")) return { ok: true };
    return undefined;
  });
  vi.stubGlobal("browser", {
    runtime: { sendMessage },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: vi.fn((listener: StorageListener) => {
          storageListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
    tabs: { create: vi.fn() },
  });
});

async function openSync() {
  render(<Popup />);
  fireEvent.click(screen.getByText("Sync"));
  await waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({ type: "sync/status" }),
  );
}

async function connectMarker() {
  fireEvent.click(screen.getByRole("button", { name: "Connect Marker" }));
}

describe("popup entrypoint sync integration", () => {
  it("refuses to open a persisted URL outside the provider allowlist", () => {
    expect(openPersistedWatchUrl("https://example.com/watch/episode")).toBe(
      false,
    );
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it("shows bookmark failures without requiring the Sync panel", async () => {
    const bookmark = {
      platform: "netflix",
      seriesId: "dark",
      seriesTitle: "Dark",
      seriesUrl: "https://www.netflix.com/title/dark",
      seasonNumber: "1",
      episodeNumber: "2",
      episodeTitle: "Lies",
      episodeId: "dark-2",
      watchUrl: "https://www.netflix.com/watch/dark-2",
      updatedAt: 1,
    };
    vi.mocked(browser.storage.local.get).mockImplementation(async (key) =>
      typeof key === "string"
        ? { [key]: { version: 1, bookmarks: { "netflix:dark": bookmark } } }
        : {},
    );
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "sync/status") return { signedIn: false };
      if (message.type === "bookmark/remove")
        throw new Error("storage unavailable");
      return { ok: true };
    });

    render(<Popup />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Dark" }));

    expect(
      await screen.findByText("Couldn’t remove the saved episode"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sync").closest("details")).not.toHaveAttribute(
      "open",
    );
  });

  it("routes website connection to the background and updates the UI on success", async () => {
    await openSync();
    sendMessage.mockResolvedValueOnce({
      signedIn: true,
      accountLabel: "@viewer",
    });
    await connectMarker();
    await screen.findByText("@viewer");
    expect(sendMessage).toHaveBeenCalledWith({ type: "sync/connect" });
    expect(
      screen.getByText("Signed in", { selector: "i" }),
    ).toBeInTheDocument();
  });

  it("shows an error when sign-in fails", async () => {
    await openSync();
    sendMessage.mockRejectedValueOnce(new Error("bad credentials"));
    await connectMarker();
    expect(
      await screen.findByText("Couldn’t connect Marker. Try again."),
    ).toBeInTheDocument();
  });

  it("shows an error for a structured rejected sign-in", async () => {
    await openSync();
    sendMessage.mockResolvedValueOnce({
      signedIn: false,
      reason: "Invalid credentials",
    });
    await connectMarker();
    expect(
      await screen.findByText("Couldn’t connect Marker. Try again."),
    ).toBeInTheDocument();
  });

  it("explains how to finish the Clerk website connection", async () => {
    await openSync();
    sendMessage.mockResolvedValueOnce({
      signedIn: false,
      reason: "sign-in-opened",
    });
    await connectMarker();
    expect(
      await screen.findByText(
        "Finish signing in on the Marker website, then reopen this popup.",
      ),
    ).toBeInTheDocument();
  });

  it("routes sign-out and clears the signed-in UI", async () => {
    sendMessage.mockResolvedValueOnce({
      signedIn: true,
      accountLabel: "@viewer",
    });
    await openSync();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ type: "sync/signOut" }),
    );
    expect(
      await screen.findByRole("button", { name: "Connect Marker" }),
    ).toBeInTheDocument();
  });

  it("preserves signed-in state when sign-out delivery fails", async () => {
    sendMessage.mockResolvedValueOnce({
      signedIn: true,
      accountLabel: "@viewer",
    });
    await openSync();
    sendMessage.mockRejectedValueOnce(new Error("background unavailable"));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText("Couldn’t sign out. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("@viewer")).toBeInTheDocument();
  });
});


describe("independent popup hydration", () => {
  it("still hydrates sign-in when a bookmark update arrives during loading", async () => {
    let resolveStatus!: (value: unknown) => void;
    sendMessage.mockReturnValue(new Promise((resolve) => { resolveStatus = resolve; }));
    render(<Popup />);
    await act(async () => {
      storageListener({ "markerBookmarks": { newValue: { version: 1, bookmarks: {} } } }, "local");
      resolveStatus({ signedIn: true, accountLabel: "@viewer" });
    });
    expect(await screen.findByText("@viewer")).toBeInTheDocument();
  });

  it("preserves signed-in state when background sign-out returns an error", async () => {
    sendMessage.mockResolvedValueOnce({ signedIn: true, accountLabel: "@viewer" });
    await openSync();
    sendMessage.mockResolvedValueOnce({ ok: false, reason: "background-error" });
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Couldn’t sign out. Please try again.")).toBeInTheDocument();
    expect(screen.getByText("@viewer")).toBeInTheDocument();
  });
});
