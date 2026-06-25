export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const publish = () => {
      const match = /^\/watch\/(\d+)/.exec(location.pathname);
      if (!match?.[1]) return;
      const netflixState = (
        window as typeof window & {
          netflix?: {
            falcorCache?: {
              videos?: Record<
                string,
                { summary?: { value?: Record<string, unknown> } }
              >;
            };
          };
        }
      ).netflix;
      const summary = netflixState?.falcorCache?.videos?.[match[1]]?.summary?.value;
      if (!summary) return;
      const safeSummary = {
        type: summary.type,
        id: summary.id ?? match[1],
        episode: summary.episode,
        season: summary.season,
      };
      const serialized = JSON.stringify(safeSummary);
      if (document.documentElement.dataset.netflixVideoSummary === serialized) {
        return;
      }
      document.documentElement.dataset.netflixVideoSummary = serialized;
      window.dispatchEvent(new CustomEvent('marker:metadata'));
    };

    new MutationObserver(publish).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.setInterval(publish, 250);
    publish();
  },
});
