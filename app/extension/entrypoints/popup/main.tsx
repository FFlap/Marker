import { createPopupClient } from "../../src/domain/popup";
import { createPopupStore } from "../../src/domain/popup-store";
import React from "react";
import ReactDOM from "react-dom/client";
import { validatedProviderUrl } from "../../src/domain/bookmarks";
import { App } from "./App";
import "./style.css";

export function openPersistedWatchUrl(url: string) {
  const validated = validatedProviderUrl(url);
  if (!validated) return false;
  void browser.tabs.create({ url: validated });
  window.close();
  return true;
}

export function Popup() {
  const [client] = React.useState(() =>
    createPopupClient(browser.storage.local, (message) =>
      browser.runtime.sendMessage(message),
    ),
  );
  const [store] = React.useState(() =>
    createPopupStore(client, browser.storage.onChanged),
  );
  const { bookmarks, bookmarkError, syncError, ...sync } =
    React.useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [syncNotice, setSyncNotice] = React.useState<string>();

  return (
    <App
      bookmarks={bookmarks}
      bookmarkError={bookmarkError}
      onOpen={(url) => {
        store.update({ bookmarkError: undefined });
        if (!openPersistedWatchUrl(url)) {
          store.update({ bookmarkError: "Saved episode link is invalid" });
        }
      }}
      onRemove={async (key) => {
        store.update({ bookmarkError: undefined });
        try {
          await client.mutate({ type: "bookmark/remove", key });
        } catch {
          store.update({ bookmarkError: "Couldn’t remove the saved episode" });
        }
      }}
      onClear={async () => {
        store.update({ bookmarkError: undefined });
        try {
          await client.mutate({ type: "bookmark/clear" });
        } catch {
          store.update({ bookmarkError: "Couldn’t clear saved episodes" });
        }
      }}
      sync={{
        ...sync,
        error: syncError,
        notice: syncNotice,
        onConnect: async () => {
          store.startAuthChange();
          setSyncNotice(undefined);
          try {
            const status = await client.status("sync/connect");
            if (!status.signedIn) {
              if (status.reason === "sign-in-opened") {
                setSyncNotice(
                  "Finish signing in on the Marker website, then reopen this popup.",
                );
              } else {
                store.update({
                  syncError: "Couldn’t connect Marker. Try again.",
                });
              }
              return;
            }
            store.update({
              signedIn: status.signedIn,
              accountLabel: status.accountLabel,
            });
          } catch {
            store.update({ syncError: "Couldn’t connect Marker. Try again." });
          }
        },
        onSignOut: async () => {
          store.startAuthChange();
          try {
            const status = await client.status("sync/signOut");
            if (status?.signedIn !== false) throw new Error("Sign-out failed");
            store.update({
              signedIn: false,
              accountLabel: undefined,
            });
          } catch {
            store.update({ syncError: "Couldn’t sign out. Please try again." });
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
