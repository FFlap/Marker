import { parseEpisodePage, parseWatchPath } from '../src/domain/episode-parser';
import { persistDetectedEpisode } from '../src/domain/tracking';

export default defineContentScript({
  matches: ['https://www.crunchyroll.com/*'],
  runAt: 'document_idle',
  main() {
    document.documentElement.dataset.crunchyrollBookmark = 'loaded';
    let lastSentEpisodeId: string | null = null;
    let lastObservedUrl = location.href;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryCount = 0;

    const inspect = () => {
      if (!parseWatchPath(location.pathname)) {
        lastSentEpisodeId = null;
        retryCount = 0;
        return;
      }

      const bookmark = parseEpisodePage(document, new URL(location.href));
      if (bookmark && bookmark.episodeId !== lastSentEpisodeId) {
        lastSentEpisodeId = bookmark.episodeId;
        document.documentElement.dataset.crunchyrollBookmark = 'saving';
        void persistDetectedEpisode(browser.storage.local, bookmark)
          .then(() => {
            document.documentElement.dataset.crunchyrollBookmark = 'tracked';
          })
          .catch((error: unknown) => {
            document.documentElement.dataset.crunchyrollBookmark = 'error';
            console.error('[Crunchyroll Bookmark] Failed to save episode', error);
            lastSentEpisodeId = null;
          });
        retryCount = 0;
        return;
      }

      if (!bookmark && retryCount < 20) {
        document.documentElement.dataset.crunchyrollBookmark = 'waiting';
        retryCount += 1;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(inspect, 500);
      }
    };

    const handleNavigation = () => {
      lastSentEpisodeId = null;
      retryCount = 0;
      clearTimeout(retryTimer);
      queueMicrotask(inspect);
    };

    for (const methodName of ['pushState', 'replaceState'] as const) {
      const original = history[methodName];
      history[methodName] = function (...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('crunchyroll-bookmark:navigation'));
        return result;
      };
    }

    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('crunchyroll-bookmark:navigation', handleNavigation);

    const observer = new MutationObserver(() => {
      if (parseWatchPath(location.pathname)) inspect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.setInterval(() => {
      if (location.href === lastObservedUrl) return;
      lastObservedUrl = location.href;
      handleNavigation();
    }, 500);

    inspect();
  },
});
