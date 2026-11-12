import { transitionHydration, type HydrationState } from "./sync-lifecycle";
import {
  BOOKMARKS_STORAGE_KEY,
  normalizeBookmarkStore,
  sortBookmarks,
} from "./bookmarks";
import { createPopupClient, parseLastResult } from "./popup";
import { SYNC_LAST_RESULT_KEY } from "./sync";
import type { EpisodeBookmark } from "./types";

type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

type PopupSnapshot = {
  bookmarks: EpisodeBookmark[];
  bookmarkError?: string;
  signedIn: boolean;
  accountLabel?: string;
  lastResult?: ReturnType<typeof parseLastResult>;
  syncError?: string;
};

/** Hydration and browser events share one snapshot, owned by its subscribers. */
export function createPopupStore(
  client: ReturnType<typeof createPopupClient>,
  storageChanges: {
    addListener: (listener: StorageListener) => void;
    removeListener: (listener: StorageListener) => void;
  },
) {
  let snapshot: PopupSnapshot = { bookmarks: [], signedIn: false };
  const listeners = new Set<() => void>();
  let subscription:
    { state: "stopped" } | { state: "subscribed"; stop: () => void } = {
    state: "stopped",
  };
  let statusRevision = 0;

  const update = (patch: Partial<PopupSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };

  const start = () => {
    const controller = new AbortController();
    const revision = ++statusRevision;
    let bookmarkHydration: HydrationState = "pending";
    let resultHydration: HydrationState = "pending";
    const active = () => !controller.signal.aborted;
    const onStorageChanged: StorageListener = (changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[BOOKMARKS_STORAGE_KEY]) {
        bookmarkHydration = transitionHydration(
          bookmarkHydration,
          "storageChanged",
        );
        update({
          bookmarks: sortBookmarks(
            normalizeBookmarkStore(changes[BOOKMARKS_STORAGE_KEY].newValue)
              .bookmarks,
          ),
        });
      }
      const lastResultChange = changes[SYNC_LAST_RESULT_KEY];
      if (lastResultChange) {
        resultHydration = transitionHydration(
          resultHydration,
          "storageChanged",
        );
        update({ lastResult: parseLastResult(lastResultChange.newValue) });
      }
    };
    storageChanges.addListener(onStorageChanged);

    void client.bookmarks(controller.signal).then(
      (bookmarks) => {
        if (active() && bookmarkHydration === "pending") update({ bookmarks });
      },
      () => {
        if (active() && bookmarkHydration === "pending")
          update({ bookmarkError: "Couldn’t read saved episodes" });
      },
    );
    void client.lastResult(controller.signal).then(
      (lastResult) => {
        if (active() && resultHydration === "pending") update({ lastResult });
      },
      () => {
        if (active() && resultHydration === "pending")
          update({ syncError: "Couldn’t read the last sync result" });
      },
    );
    void client.status("sync/status", controller.signal).then(
      ({ signedIn, accountLabel }) => {
        if (active() && statusRevision === revision)
          update({ signedIn, accountLabel });
      },
      () => {
        if (active() && statusRevision === revision)
          update({ syncError: "Couldn’t check sign-in status" });
      },
    );

    return () => {
      controller.abort();
      statusRevision += 1;
      storageChanges.removeListener(onStorageChanged);
    };
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1)
        subscription = { state: "subscribed", stop: start() };
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          if (subscription.state === "subscribed") subscription.stop();
          subscription = { state: "stopped" };
        }
      };
    },
    update,
    startAuthChange: () => {
      // An explicit auth action takes precedence over the initial status request.
      statusRevision += 1;
      update({ syncError: undefined });
    },
  };
}
