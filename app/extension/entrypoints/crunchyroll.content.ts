import { createContentLifetime } from "../src/domain/lifecycle";
import { parseEpisodePage, parseWatchPath } from "../src/domain/episode-parser";
import {
  persistDetectedEpisode,
  transitionInspection,
  type InspectionState,
} from "../src/domain/tracking";

export default defineContentScript({
  matches: ["https://www.crunchyroll.com/*"],
  runAt: "document_idle",
  main(ctx) {
    const lifetime = createContentLifetime((dispose) =>
      ctx.onInvalidated(dispose),
    );
    document.documentElement.dataset.markerCrunchyroll = "loaded";
    let inspection: InspectionState = { state: "waiting", lastEpisode: null };
    let lastObservedUrl = location.href;
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;

    const inspect = async () => {
      if (!lifetime.active) return;
      if (inspection.state === "saving") {
        inspection = transitionInspection(inspection, { type: "inspect" });
        return;
      }
      if (!parseWatchPath(location.pathname)) {
        inspection = transitionInspection(inspection, { type: "navigate" });
        return;
      }

      const bookmark = parseEpisodePage(document, new URL(location.href));
      if (bookmark && bookmark.episodeId !== inspection.lastEpisode) {
        inspection = transitionInspection(inspection, { type: "save" });
        document.documentElement.dataset.markerCrunchyroll = "saving";
        let inspectAgain = false;
        try {
          await persistDetectedEpisode(bookmark, undefined, lifetime.signal);
          if (!lifetime.active) return;
          inspectAgain =
            inspection.state === "saving" && inspection.inspectAgain;
          inspection = transitionInspection(inspection, {
            type: "saved",
            episodeId: bookmark.episodeId,
          });
          document.documentElement.dataset.markerCrunchyroll = "tracked";
        } catch {
          inspectAgain =
            inspection.state === "saving" && inspection.inspectAgain;
          inspection = transitionInspection(inspection, { type: "failed" });
          if (!lifetime.active) return;
          document.documentElement.dataset.markerCrunchyroll = "error";
          console.error("[Marker] Failed to save Crunchyroll episode");
        } finally {
          if (inspectAgain && lifetime.active) {
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
      inspection = transitionInspection(inspection, { type: "navigate" });
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
