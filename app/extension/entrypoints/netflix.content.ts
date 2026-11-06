import { createContentLifetime } from "../src/domain/lifecycle";
import {
  parseNetflixPage,
  parseNetflixWatchPath,
} from "../src/domain/netflix-parser";
import {
  persistDetectedEpisode,
  transitionInspection,
  type InspectionState,
} from "../src/domain/tracking";

export default defineContentScript({
  matches: ["https://www.netflix.com/*"],
  runAt: "document_idle",
  main(ctx) {
    const lifetime = createContentLifetime((dispose) =>
      ctx.onInvalidated(dispose),
    );
    document.documentElement.dataset.markerNetflix = "loaded";
    let lastUrl = location.href;
    let inspection: InspectionState = { state: "waiting", lastEpisode: null };
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay = 150, replace = false) => {
      if (!lifetime.active) return;
      if (inspectionTimer && !replace) return;
      clearTimeout(inspectionTimer);
      inspectionTimer = setTimeout(() => void inspect(), delay);
    };

    const inspect = async () => {
      if (!lifetime.active) return;
      inspectionTimer = undefined;
      if (inspection.state === "saving") {
        inspection = transitionInspection(inspection, { type: "inspect" });
        return;
      }
      const bookmark = parseNetflixPage(document, new URL(location.href));
      if (!bookmark) {
        document.documentElement.dataset.markerNetflix = "waiting";
        return;
      }

      if (bookmark.episodeId === inspection.lastEpisode) return;

      inspection = transitionInspection(inspection, { type: "save" });
      document.documentElement.dataset.markerNetflix = "saving";
      let inspectAgain = false;
      try {
        await persistDetectedEpisode(bookmark, undefined, lifetime.signal);
        if (!lifetime.active) return;
        inspectAgain = inspection.state === "saving" && inspection.inspectAgain;
        inspection = transitionInspection(inspection, {
          type: "saved",
          episodeId: bookmark.episodeId,
        });
        document.documentElement.dataset.markerNetflix = "tracked";
      } catch {
        inspectAgain = inspection.state === "saving" && inspection.inspectAgain;
        inspection = transitionInspection(inspection, { type: "failed" });
        if (!lifetime.active) return;
        document.documentElement.dataset.markerNetflix = "error";
        console.error("[Marker] Failed to save Netflix episode");
      } finally {
        if (inspectAgain && lifetime.active) {
          schedule(0, true);
        }
      }
    };

    const resetForNavigation = () => {
      inspection = transitionInspection(inspection, { type: "navigate" });
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
      } else if (!inspection.lastEpisode) {
        schedule(0, true);
      }
    }, 250);

    lifetime.own(() => observer.disconnect());
    lifetime.own(() => window.clearInterval(interval));
    lifetime.own(() => clearTimeout(inspectionTimer));
    schedule(0, true);
  },
});
