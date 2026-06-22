import React from 'react';
import ReactDOM from 'react-dom/client';
import { normalizeBookmarkStore, sortBookmarks } from '../../src/domain/bookmarks';
import type { EpisodeBookmark } from '../../src/domain/types';
import { BOOKMARKS_STORAGE_KEY } from '../../src/messages';
import { App } from './App';
import './style.css';

async function readBookmarks(): Promise<EpisodeBookmark[]> {
  const stored = await browser.storage.local.get(BOOKMARKS_STORAGE_KEY);
  return sortBookmarks(
    normalizeBookmarkStore(stored[BOOKMARKS_STORAGE_KEY]).bookmarks,
  );
}

function Popup() {
  const [bookmarks, setBookmarks] = React.useState<EpisodeBookmark[]>([]);

  React.useEffect(() => {
    void readBookmarks().then(setBookmarks);
    const onStorageChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes[BOOKMARKS_STORAGE_KEY]) return;
      setBookmarks(
        sortBookmarks(
          normalizeBookmarkStore(changes[BOOKMARKS_STORAGE_KEY].newValue).bookmarks,
        ),
      );
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => browser.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  const save = async (next: EpisodeBookmark[]) => {
    await browser.storage.local.set({
      [BOOKMARKS_STORAGE_KEY]: {
        version: 1,
        bookmarks: Object.fromEntries(next.map((item) => [item.seriesId, item])),
      },
    });
  };

  return (
    <App
      bookmarks={bookmarks}
      onOpen={(url) => {
        void browser.tabs.create({ url });
        window.close();
      }}
      onRemove={(seriesId) => {
        void save(bookmarks.filter((item) => item.seriesId !== seriesId));
      }}
      onClear={() => void save([])}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);

