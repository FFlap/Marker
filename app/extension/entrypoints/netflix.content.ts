import { createContentLifetime } from "../src/domain/lifecycle";
import {
  parseNetflixPage,
  parseNetflixWatchPath,
} from "../src/domain/netflix-parser";
import { persistDetectedEpisode } from "../src/domain/tracking";

export default defineContentScript({
  matches: ["https://www.netflix.com/*"],
  runAt: "document_idle",
  main(ctx) {
    const lifetime = createContentLifetime((dispose) =>
      ctx.onInvalidated(dispose),
    );
    document.documentElement.dataset.markerNetflix = "loaded";
    let lastUrl = location.href;
    let lastSavedVideoId: string | null = null;
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;
    let saveInFlight = false;
    let inspectAgain = false;

    const schedule = (delay = 150, replace = false) => {
      if (!lifetime.active) return;
      if (inspectionTimer && !replace) return;
      clearTimeout(inspectionTimer);
      inspectionTimer = setTimeout(() => void inspect(), delay);
    };

    const inspect = async () => {
      if (!lifetime.active) return;
      inspectionTimer = undefined;
      if (saveInFlight) {
        inspectAgain = true;
        return;
      }
      const bookmark = parseNetflixPage(document, new URL(location.href));
      if (!bookmark) {
        document.documentElement.dataset.markerNetflix = "waiting";
        return;
      }

      if (bookmark.episodeId === lastSavedVideoId) return;

      saveInFlight = true;
      document.documentElement.dataset.markerNetflix = "saving";
      try {
        await persistDetectedEpisode(bookmark, undefined, lifetime.signal);
        if (!lifetime.active) return;
        lastSavedVideoId = bookmark.episodeId;
        document.documentElement.dataset.markerNetflix = "tracked";
      } catch {
        if (!lifetime.active) return;
        document.documentElement.dataset.markerNetflix = "error";
        console.error("[Marker] Failed to save Netflix episode");
      } finally {
        saveInFlight = false;
        if (inspectAgain && lifetime.active) {
          inspectAgain = false;
          schedule(0, true);
        }
      }
    };

    const resetForNavigation = () => {
      lastSavedVideoId = null;
      schedule(0, true);
    };

    for (const methodName of ["pushState", "replaceState"] as const) {
      const original = history[methodName];
      const patched: typeof original = function (this: History, ...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("marker:navigation"));
        return result;
      };
      history[methodName] = patched;
      lifetime.own(() => {
        if (history[methodName] === patched) history[methodName] = original;
      });
    }

    lifetime.listen(window, "popstate", resetForNavigation);
    lifetime.listen(window, "marker:navigation", resetForNavigation);
    lifetime.listen(window, "marker:metadata", () => schedule(0, true));
    lifetime.listen(window, "pageshow", resetForNavigation);
    lifetime.listen(window, "focus", () => schedule(0, true));
    lifetime.listen(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") schedule(0, true);
    });

    const observer = new MutationObserver(() => {
      if (parseNetflixWatchPath(location.pathname)) schedule();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const interval = window.setInterval(() => {
      if (document.hidden || !parseNetflixWatchPath(location.pathname)) return;
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        resetForNavigation();
      } else if (!lastSavedVideoId) {
        schedule(0, true);
      }
    }, 250);

    lifetime.own(() => observer.disconnect());
    lifetime.own(() => window.clearInterval(interval));
    lifetime.own(() => clearTimeout(inspectionTimer));
    schedule(0, true);
  },
});
