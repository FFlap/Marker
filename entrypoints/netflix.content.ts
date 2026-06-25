import { parseNetflixPage, parseNetflixWatchPath } from '../src/domain/netflix-parser';
import { persistDetectedEpisode } from '../src/domain/tracking';

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_idle',
  main() {
    delete document.documentElement.dataset.netflixBookmark;
    document.documentElement.dataset.markerNetflix = 'loaded';
    let lastUrl = location.href;
    let lastSavedVideoId: string | null = null;
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;
    let saveInFlight = false;
    let inspectAgain = false;

    const schedule = (delay = 150, replace = false) => {
      if (inspectionTimer && !replace) return;
      clearTimeout(inspectionTimer);
      inspectionTimer = setTimeout(() => void inspect(), delay);
    };

    const inspect = async () => {
      inspectionTimer = undefined;
      if (saveInFlight) {
        inspectAgain = true;
        return;
      }
      const bookmark = parseNetflixPage(document, new URL(location.href));
      if (!bookmark) {
        document.documentElement.dataset.markerNetflix = 'waiting';
        return;
      }

      if (bookmark.episodeId === lastSavedVideoId) return;

      saveInFlight = true;
      document.documentElement.dataset.markerNetflix = 'saving';
      try {
        await persistDetectedEpisode(browser.storage.local, bookmark);
        lastSavedVideoId = bookmark.episodeId;
        document.documentElement.dataset.markerNetflix = 'tracked';
      } catch (error: unknown) {
        document.documentElement.dataset.markerNetflix = 'error';
        console.error('[Marker] Failed to save Netflix episode', error);
      } finally {
        saveInFlight = false;
        if (inspectAgain) {
          inspectAgain = false;
          schedule(0, true);
        }
      }

    };

    const resetForNavigation = () => {
      lastSavedVideoId = null;
      schedule(0, true);
    };

    for (const methodName of ['pushState', 'replaceState'] as const) {
      const original = history[methodName];
      history[methodName] = function (...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('marker:navigation'));
        return result;
      };
    }

    window.addEventListener('popstate', resetForNavigation);
    window.addEventListener('marker:navigation', resetForNavigation);
    window.addEventListener('marker:metadata', () => schedule(0, true));
    window.addEventListener('pageshow', resetForNavigation);
    window.addEventListener('focus', () => schedule(0, true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedule(0, true);
    });

    new MutationObserver(() => {
      if (parseNetflixWatchPath(location.pathname)) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });

    window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        resetForNavigation();
      } else if (parseNetflixWatchPath(location.pathname)) {
        schedule(0, true);
      }
    }, 250);

    schedule(0, true);
  },
});
