import React from "react";
import ReactDOM from "react-dom/client";
import {
  normalizeBookmarkStore,
  sortBookmarks,
  validatedProviderUrl,
} from "../../src/domain/bookmarks";
import type { EpisodeBookmark } from "../../src/domain/types";
import { BOOKMARKS_STORAGE_KEY } from "../../src/messages";
import { SYNC_LAST_RESULT_KEY } from "../../src/domain/sync";
import { App } from "./App";
import "./style.css";

async function readBookmarks(): Promise<EpisodeBookmark[]> {
  const stored = await browser.storage.local.get(BOOKMARKS_STORAGE_KEY);
  return sortBookmarks(
    normalizeBookmarkStore(stored[BOOKMARKS_STORAGE_KEY]).bookmarks,
  );
}

function subscribeToStorageChanges(
  listener: Parameters<typeof browser.storage.onChanged.addListener>[0],
) {
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

export function openPersistedWatchUrl(url: string) {
  const validated = validatedProviderUrl(url);
  if (!validated) return false;
  void browser.tabs.create({ url: validated });
  window.close();
  return true;
}

export function Popup() {
  const hydrationRevision = React.useRef(0);
  const [bookmarks, setBookmarks] = React.useState<EpisodeBookmark[]>([]);
  const [bookmarkError, setBookmarkError] = React.useState<string>();
  const [sync, setSync] = React.useState({
    signedIn: false,
    accountLabel: undefined as string | undefined,
    lastResult: undefined as
      | { ok: boolean; at: number; reason?: string; seriesTitle?: string }
      | undefined,
  });
  const [syncError, setSyncError] = React.useState<string>();
  const [syncNotice, setSyncNotice] = React.useState<string>();

  React.useEffect(() => {
    const revision = ++hydrationRevision.current;
    let active = true;
    const isCurrent = () => active && hydrationRevision.current === revision;
    void readBookmarks()
      .then((next) => {
        if (isCurrent()) setBookmarks(next);
      })
      .catch(() => {
        if (isCurrent()) setBookmarkError("Couldn’t read saved episodes");
      });
    void browser.storage.local
      .get([SYNC_LAST_RESULT_KEY])
      .then(async (stored) => {
        try {
          const status = (await browser.runtime.sendMessage({
            type: "sync/status",
          })) as { signedIn: boolean; accountLabel?: string };
          if (!isCurrent()) return;
          setSync({
            signedIn: status.signedIn,
            accountLabel: status.accountLabel,
            lastResult: stored[SYNC_LAST_RESULT_KEY] as
              | {
                  ok: boolean;
                  at: number;
                  reason?: string;
                  seriesTitle?: string;
                  unverified?: boolean;
                }
              | undefined,
          });
        } catch {
          if (!isCurrent()) return;
          setSyncError("Couldn't check sign-in status");
          setSync((current) => ({
            ...current,
            lastResult: stored[SYNC_LAST_RESULT_KEY] as
              | {
                  ok: boolean;
                  at: number;
                  reason?: string;
                  seriesTitle?: string;
                  unverified?: boolean;
                }
              | undefined,
          }));
        }
      })
      .catch(() => {
        if (isCurrent()) setSyncError("Couldn’t check sign-in status");
      });
    const onStorageChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;
      if (changes[BOOKMARKS_STORAGE_KEY] || changes[SYNC_LAST_RESULT_KEY]) {
        hydrationRevision.current += 1;
      }
      if (changes[BOOKMARKS_STORAGE_KEY]) {
        setBookmarks(
          sortBookmarks(
            normalizeBookmarkStore(changes[BOOKMARKS_STORAGE_KEY].newValue)
              .bookmarks,
          ),
        );
      }
      const lastResultChange = changes[SYNC_LAST_RESULT_KEY];
      if (lastResultChange) {
        setSync((current) => ({
          ...current,
          lastResult: lastResultChange.newValue as
            | {
                ok: boolean;
                at: number;
                reason?: string;
                seriesTitle?: string;
                unverified?: boolean;
              }
            | undefined,
        }));
      }
    };
    const unsubscribe = subscribeToStorageChanges(onStorageChanged);
    return () => {
      active = false;
      hydrationRevision.current += 1;
      unsubscribe();
    };
  }, []);

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
          const response = (await browser.runtime.sendMessage({
            type: "bookmark/remove",
            key,
          })) as { ok?: unknown };
          if (response?.ok !== true) throw new Error("Remove failed");
        } catch {
          setBookmarkError("Couldn’t remove the saved episode");
        }
      }}
      onClear={async () => {
        setBookmarkError(undefined);
        try {
          const response = (await browser.runtime.sendMessage({
            type: "bookmark/clear",
          })) as { ok?: unknown };
          if (response?.ok !== true) throw new Error("Clear failed");
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
            const status = (await browser.runtime.sendMessage({
              type: "sync/connect",
            })) as {
              signedIn: boolean;
              accountLabel?: string;
              reason?: string;
            };
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
            await browser.runtime.sendMessage({ type: "sync/signOut" });
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
