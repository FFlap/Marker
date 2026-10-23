import { createPopupClient, parseLastResult } from "../../src/domain/popup";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  BOOKMARKS_STORAGE_KEY,
  normalizeBookmarkStore,
  sortBookmarks,
  validatedProviderUrl,
} from "../../src/domain/bookmarks";
import type { EpisodeBookmark } from "../../src/domain/types";
import { SYNC_LAST_RESULT_KEY } from "../../src/domain/sync";
import { App } from "./App";
import "./style.css";

export function openPersistedWatchUrl(url: string) {
  const validated = validatedProviderUrl(url);
  if (!validated) return false;
  void browser.tabs.create({ url: validated });
  window.close();
  return true;
}

type LastSyncResult = NonNullable<
  React.ComponentProps<typeof App>["sync"]
>["lastResult"];

export function Popup() {
  const client = React.useMemo(
    () =>
      createPopupClient(browser.storage.local, (message) =>
        browser.runtime.sendMessage(message),
      ),
    [],
  );
  const hydrationRevision = React.useRef(0);
  const [bookmarks, setBookmarks] = React.useState<EpisodeBookmark[]>([]);
  const [bookmarkError, setBookmarkError] = React.useState<string>();
  const [sync, setSync] = React.useState({
    signedIn: false,
    accountLabel: undefined as string | undefined,
    lastResult: undefined as LastSyncResult,
  });
  const [syncError, setSyncError] = React.useState<string>();
  const [syncNotice, setSyncNotice] = React.useState<string>();

  React.useEffect(() => {
    const controller = new AbortController();
    const revision = ++hydrationRevision.current;
    let active = true;
    let bookmarksChanged = false;
    let lastResultChanged = false;
    void client
      .bookmarks(controller.signal)
      .then((next) => {
        if (active && !bookmarksChanged) setBookmarks(next);
      })
      .catch(() => {
        if (active && !bookmarksChanged)
          setBookmarkError("Couldn’t read saved episodes");
      });
    void client
      .lastResult(controller.signal)
      .then((lastResult) => {
        if (active && !lastResultChanged) {
          setSync((current) => ({ ...current, lastResult }));
        }
      })
      .catch(() => {
        if (active && !lastResultChanged)
          setSyncError("Couldn’t read the last sync result");
      });
    void client
      .status("sync/status", controller.signal)
      .then((status: { signedIn: boolean; accountLabel?: string }) => {
        if (active && hydrationRevision.current === revision) {
          setSync((current) => ({
            ...current,
            signedIn: status.signedIn,
            accountLabel: status.accountLabel,
          }));
        }
      })
      .catch(() => {
        if (active && hydrationRevision.current === revision)
          setSyncError("Couldn’t check sign-in status");
      });
    const onStorageChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;
      if (changes[BOOKMARKS_STORAGE_KEY]) {
        bookmarksChanged = true;
        setBookmarks(
          sortBookmarks(
            normalizeBookmarkStore(changes[BOOKMARKS_STORAGE_KEY].newValue)
              .bookmarks,
          ),
        );
      }
      const lastResultChange = changes[SYNC_LAST_RESULT_KEY];
      if (lastResultChange) {
        lastResultChanged = true;
        setSync((current) => ({
          ...current,
          lastResult: parseLastResult(lastResultChange.newValue),
        }));
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => {
      active = false;
      controller.abort();
      hydrationRevision.current += 1;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [client]);

  return (
    <App
      bookmarks={bookmarks}
      bookmarkError={bookmarkError}
      onOpen={(url) => {
        setBookmarkError(undefined);
        if (!openPersistedWatchUrl(url)) {
          setBookmarkError("Saved episode link is invalid");
        }
      }}
      onRemove={async (key) => {
        setBookmarkError(undefined);
        try {
          await client.mutate({ type: "bookmark/remove", key });
        } catch {
          setBookmarkError("Couldn’t remove the saved episode");
        }
      }}
      onClear={async () => {
        setBookmarkError(undefined);
        try {
          await client.mutate({ type: "bookmark/clear" });
        } catch {
          setBookmarkError("Couldn’t clear saved episodes");
        }
      }}
      sync={{
        ...sync,
        error: syncError,
        notice: syncNotice,
        onConnect: async () => {
          hydrationRevision.current += 1;
          setSyncError(undefined);
          setSyncNotice(undefined);
          try {
            const status = await client.status("sync/connect");
            if (!status.signedIn) {
              if (status.reason === "sign-in-opened") {
                setSyncNotice(
                  "Finish signing in on the Marker website, then reopen this popup.",
                );
              } else {
                setSyncError("Couldn’t connect Marker. Try again.");
              }
              return;
            }
            setSync((current) => ({ ...current, ...status }));
          } catch {
            setSyncError("Couldn’t connect Marker. Try again.");
          }
        },
        onSignOut: async () => {
          hydrationRevision.current += 1;
          setSyncError(undefined);
          try {
            const status = await client.status("sync/signOut");
            if (status?.signedIn !== false) throw new Error("Sign-out failed");
            setSync((current) => ({
              ...current,
              signedIn: false,
              accountLabel: undefined,
            }));
          } catch {
            setSyncError("Couldn’t sign out. Please try again.");
          }
        },
      }}
    />
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>,
  );
}
