import { createContentLifetime } from "../src/domain/lifecycle";
import { parseEpisodePage, parseWatchPath } from "../src/domain/episode-parser";
import { persistDetectedEpisode } from "../src/domain/tracking";

export default defineContentScript({
  matches: ["https://www.crunchyroll.com/*"],
  runAt: "document_idle",
  main(ctx) {
    const lifetime = createContentLifetime((dispose) =>
      ctx.onInvalidated(dispose),
    );
    document.documentElement.dataset.markerCrunchyroll = "loaded";
    let lastSentEpisodeId: string | null = null;
    let lastObservedUrl = location.href;
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;
    let saveInFlight = false;
    let inspectAgain = false;

    const inspect = async () => {
      if (!lifetime.active) return;
      if (saveInFlight) {
        inspectAgain = true;
        return;
      }
      if (!parseWatchPath(location.pathname)) {
        lastSentEpisodeId = null;
        return;
      }

      const bookmark = parseEpisodePage(document, new URL(location.href));
      if (bookmark && bookmark.episodeId !== lastSentEpisodeId) {
        saveInFlight = true;
        document.documentElement.dataset.markerCrunchyroll = "saving";
        try {
          await persistDetectedEpisode(bookmark, undefined, lifetime.signal);
          if (!lifetime.active) return;
          lastSentEpisodeId = bookmark.episodeId;
          document.documentElement.dataset.markerCrunchyroll = "tracked";
        } catch {
          if (!lifetime.active) return;
          document.documentElement.dataset.markerCrunchyroll = "error";
          console.error("[Marker] Failed to save Crunchyroll episode");
        } finally {
          saveInFlight = false;
          if (inspectAgain && lifetime.active) {
            inspectAgain = false;
            scheduleInspect(0);
          }
        }
        return;
      }

      if (!bookmark) {
        document.documentElement.dataset.markerCrunchyroll = "waiting";
      }
    };

    const scheduleInspect = (delay = 100) => {
      if (!lifetime.active) return;
      clearTimeout(inspectionTimer);
      inspectionTimer = setTimeout(() => void inspect(), delay);
    };

    const handleNavigation = () => {
      lastSentEpisodeId = null;
      scheduleInspect(0);
    };

    for (const methodName of ["pushState", "replaceState"] as const) {
      const original = history[methodName];
      const patched: typeof original = function (this: History, ...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("marker:crunchyroll-navigation"));
        return result;
      };
      history[methodName] = patched;
      lifetime.own(() => {
        if (history[methodName] === patched) history[methodName] = original;
      });
    }

    lifetime.listen(window, "popstate", handleNavigation);
    lifetime.listen(window, "marker:crunchyroll-navigation", handleNavigation);

    const observer = new MutationObserver(() => {
      if (parseWatchPath(location.pathname)) scheduleInspect();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const interval = window.setInterval(() => {
      if (location.href !== lastObservedUrl) {
        lastObservedUrl = location.href;
        handleNavigation();
        return;
      }
      if (parseWatchPath(location.pathname)) scheduleInspect(0);
    }, 1000);

    lifetime.own(() => observer.disconnect());
    lifetime.own(() => window.clearInterval(interval));
    lifetime.own(() => clearTimeout(inspectionTimer));
    scheduleInspect(0);
  },
});
