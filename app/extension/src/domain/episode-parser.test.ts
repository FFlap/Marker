import { describe, expect, it } from "vitest";
import { parseEpisodePage, parseWatchPath } from "./episode-parser";

function makeDocument(html: string, title: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  Object.defineProperty(document, "title", {
    value: title,
    configurable: true,
  });
  return document;
}

describe("parseWatchPath", () => {
  it("recognizes a Crunchyroll watch URL", () => {
    expect(parseWatchPath("/watch/GRQW9GW7R/the-storm-dragon-veldora")).toEqual(
      {
        episodeId: "GRQW9GW7R",
        slug: "the-storm-dragon-veldora",
      },
    );
  });

  it("rejects non-watch paths", () => {
    expect(parseWatchPath("/series/GYZJ43JMR/slime")).toBeNull();
  });
});

describe("parseEpisodePage", () => {
  it("prioritizes complete TVEpisode JSON-LD over conflicting visible page metadata", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "name": "Specials | E4 - Operation Quintuplets (Part 2)",
            "episodeNumber": 4,
            "url": "https://www.crunchyroll.com/watch/GE00375174JAJP/operation-quintuplets-part-2",
            "partOfSeason": {
              "@type": "TVSeason",
              "name": "Specials",
              "seasonNumber": 4
            },
            "partOfSeries": {
              "@type": "TVSeries",
              "name": "The Quintessential Quintuplets",
              "@id": "https://www.crunchyroll.com/series/GY4PD7Z06/the-quintessential-quintuplets"
            }
          }
        </script>
        <a href="/series/WRONG123/wrong-series">Wrong Series</a>
        <h1>E99 - Wrong Episode</h1>
      `,
      "Wrong Season 99 Wrong Episode - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL(
          "https://www.crunchyroll.com/watch/GE00375174JAJP/operation-quintuplets-part-2",
        ),
        5,
      ),
    ).toEqual({
      platform: "crunchyroll",
      seriesId: "GY4PD7Z06",
      seriesTitle: "The Quintessential Quintuplets",
      seriesUrl:
        "https://www.crunchyroll.com/series/GY4PD7Z06/the-quintessential-quintuplets",
      seasonNumber: "Specials",
      episodeNumber: "4",
      episodeTitle: "Operation Quintuplets (Part 2)",
      episodeId: "GE00375174JAJP",
      watchUrl:
        "https://www.crunchyroll.com/watch/GE00375174JAJP/operation-quintuplets-part-2",
      updatedAt: 5,
    });
  });

  it("uses DOM fallbacks when JSON-LD is present but incomplete", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "episodeNumber": 3,
            "partOfSeason": { "name": "Season 2" }
          }
        </script>
        <a href="/series/GABC12345/example-show">Example Show</a>
        <h1>E3 - Visible Episode Name</h1>
      `,
      "Season 2 Visible Episode Name - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL(
          "https://www.crunchyroll.com/watch/GEP123456/visible-episode-name",
        ),
        6,
      ),
    ).toMatchObject({
      seriesId: "GABC12345",
      seriesTitle: "Example Show",
      seasonNumber: "2",
      episodeNumber: "3",
      episodeTitle: "Visible Episode Name",
    });
  });

  it("waits when JSON-LD still belongs to the previous episode during SPA navigation", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "name": "Season 1 | E7 - Previous Episode",
            "episodeNumber": 7,
            "url": "https://www.crunchyroll.com/watch/OLD000001/previous-episode",
            "partOfSeason": { "name": "Season 1", "seasonNumber": 1 },
            "partOfSeries": {
              "name": "Example Show",
              "@id": "https://www.crunchyroll.com/series/GABC12345/example-show"
            }
          }
        </script>
        <a href="/series/GABC12345/example-show">Example Show</a>
        <h1>E8 - Current Episode</h1>
      `,
      "Season 1 Current Episode - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL("https://www.crunchyroll.com/watch/NEW000002/current-episode"),
        7,
      ),
    ).toBeNull();
  });

  it("rejects cross-origin Crunchyroll-shaped JSON-LD URLs", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "name": "Season 1 | E8 - Current Episode",
            "episodeNumber": 8,
            "url": "https://example.com/watch/NEW000002/current-episode",
            "partOfSeason": { "name": "Season 1", "seasonNumber": 1 },
            "partOfSeries": {
              "name": "Example Show",
              "@id": "https://example.com/series/GABC12345/example-show"
            }
          }
        </script>
      `,
      "Season 1 Current Episode - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL("https://www.crunchyroll.com/watch/NEW000002/current-episode"),
      ),
    ).toBeNull();
  });

  it("ignores malformed structured URLs and skips malformed series links", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "name": "Season 1 | E8 - Current Episode",
            "episodeNumber": 8,
            "url": "http://[::1",
            "partOfSeason": { "name": "Season 1", "seasonNumber": 1 },
            "partOfSeries": {
              "name": "Example Show",
              "@id": "http://[::1"
            }
          }
        </script>
        <a href="http://[::1">Malformed</a>
        <a href="/series/GABC12345/example-show">Example Show</a>
        <h1>E8 - Current Episode</h1>
      `,
      "Season 1 Current Episode - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL("https://www.crunchyroll.com/watch/NEW000002/current-episode"),
      ),
    ).toMatchObject({
      seriesId: "GABC12345",
      watchUrl: "https://www.crunchyroll.com/watch/NEW000002/current-episode",
    });
  });

  it("extracts stable series, season, and episode metadata", () => {
    const document = makeDocument(
      `
        <a href="/series/GYZJ43JMR/that-time-i-got-reincarnated-as-a-slime">
          <h4>That Time I Got Reincarnated as a Slime</h4>
        </a>
        <h1>E1 - The Storm Dragon, Veldora</h1>
      `,
      "Season 1 The Storm Dragon, Veldora - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL(
          "https://www.crunchyroll.com/watch/GRQW9GW7R/the-storm-dragon-veldora",
        ),
        1719000000000,
      ),
    ).toEqual({
      platform: "crunchyroll",
      seriesId: "GYZJ43JMR",
      seriesTitle: "That Time I Got Reincarnated as a Slime",
      seriesUrl:
        "https://www.crunchyroll.com/series/GYZJ43JMR/that-time-i-got-reincarnated-as-a-slime",
      seasonNumber: "1",
      episodeNumber: "1",
      episodeTitle: "The Storm Dragon, Veldora",
      episodeId: "GRQW9GW7R",
      watchUrl:
        "https://www.crunchyroll.com/watch/GRQW9GW7R/the-storm-dragon-veldora",
      updatedAt: 1719000000000,
    });
  });

  it("supports special and decimal episode labels", () => {
    const document = makeDocument(
      `
        <a href="/series/GABC12345/example-show">Example Show</a>
        <h1>E12.5 - A Special Story</h1>
      `,
      "Season 2 A Special Story - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL("https://www.crunchyroll.com/watch/GEP123456/a-special-story"),
        10,
      )?.episodeNumber,
    ).toBe("12.5");
  });

  it("tracks a Specials category when Crunchyroll does not provide a season number", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "episodeNumber": 2,
            "partOfSeason": {
              "@type": "TVSeason",
              "name": "Specials",
              "seasonNumber": 2
            }
          }
        </script>
        <a href="/series/GY4PD7Z06/the-quintessential-quintuplets">
          The Quintessential Quintuplets
        </a>
        <h1>E2 - No Coincidences in This Summer Break (Part 2)</h1>
      `,
      "Specials No Coincidences in This Summer Break (Part 2) - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL(
          "https://www.crunchyroll.com/watch/GE00347955JAJP/no-coincidences-in-this-summer-break-part-2",
        ),
        20,
      ),
    ).toMatchObject({
      seriesId: "GY4PD7Z06",
      seasonNumber: "Specials",
      episodeNumber: "2",
      episodeTitle: "No Coincidences in This Summer Break (Part 2)",
    });
  });

  it("uses the structured season name even when its internal season number differs", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "episodeNumber": 4,
            "partOfSeason": {
              "@type": "TVSeason",
              "name": "Specials",
              "seasonNumber": 4
            }
          }
        </script>
        <a href="/series/GY4PD7Z06/the-quintessential-quintuplets">
          The Quintessential Quintuplets
        </a>
        <h1>E4 - Operation Quintuplets (Part 2)</h1>
      `,
      "A Different Page Title That Should Not Be Used",
    );

    expect(
      parseEpisodePage(
        document,
        new URL(
          "https://www.crunchyroll.com/watch/GE00375174JAJP/operation-quintuplets-part-2",
        ),
        25,
      ),
    ).toMatchObject({
      seasonNumber: "Specials",
      episodeNumber: "4",
    });
  });

  it("uses structured episode metadata when the page title contains a dub variant instead of a season", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "episodeNumber": 1,
            "partOfSeason": {
              "@type": "TVSeason",
              "name": "TONIKAWA: Over The Moon For You (English Dub)",
              "seasonNumber": 1
            },
            "partOfSeries": {
              "@type": "TVSeries",
              "name": "TONIKAWA: Over The Moon For You",
              "@id": "https://www.crunchyroll.com/series/GRWMGGQ86/tonikawa-over-the-moon-for-you"
            }
          }
        </script>
        <a href="/series/GRWMGGQ86/tonikawa-over-the-moon-for-you">
          TONIKAWA: Over The Moon For You
        </a>
        <h1>E1 - Marriage</h1>
      `,
      "TONIKAWA: Over The Moon For You (English Dub) Marriage - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL("https://www.crunchyroll.com/watch/GEVUZPJ7X/marriage"),
        30,
      ),
    ).toMatchObject({
      seriesId: "GRWMGGQ86",
      seasonNumber: "1",
      episodeNumber: "1",
      episodeTitle: "Marriage",
    });
  });

  it("uses seasonNumber when a normal non-dub season name equals the series name", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "name": "Example Show | E7 - The Return",
            "episodeNumber": 7,
            "partOfSeason": {
              "@type": "TVSeason",
              "name": "Example Show",
              "seasonNumber": 2
            },
            "partOfSeries": {
              "@type": "TVSeries",
              "name": "Example Show",
              "@id": "https://www.crunchyroll.com/series/GABC12345/example-show"
            }
          }
        </script>
      `,
      "Unrelated title",
    );

    expect(
      parseEpisodePage(
        document,
        new URL("https://www.crunchyroll.com/watch/GEP123456/the-return"),
        40,
      )?.seasonNumber,
    ).toBe("2");
  });

  it("preserves a movie name when Crunchyroll represents it as season zero", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "name": "The Quintessential Quintuplets Movie | E1 - The Quintessential Quintuplets Movie",
            "episodeNumber": 1,
            "url": "https://www.crunchyroll.com/watch/G9DUEG4WE/the-quintessential-quintuplets-movie",
            "partOfSeason": {
              "@type": "TVSeason",
              "name": "The Quintessential Quintuplets Movie",
              "seasonNumber": 0
            },
            "partOfSeries": {
              "@type": "TVSeries",
              "name": "The Quintessential Quintuplets Movie",
              "@id": "https://www.crunchyroll.com/series/GMTE00258377/the-quintessential-quintuplets-movie"
            }
          }
        </script>
      `,
      "The Quintessential Quintuplets Movie",
    );

    expect(
      parseEpisodePage(
        document,
        new URL(
          "https://www.crunchyroll.com/watch/G9DUEG4WE/the-quintessential-quintuplets-movie",
        ),
        50,
      ),
    ).toMatchObject({
      seriesTitle: "The Quintessential Quintuplets Movie",
      seasonNumber: "The Quintessential Quintuplets Movie",
      episodeNumber: "1",
      episodeTitle: "The Quintessential Quintuplets Movie",
    });
  });

  it("tracks a movie whose JSON-LD and heading omit the E1 prefix", () => {
    const document = makeDocument(
      `
        <script type="application/ld+json">
          {
            "@type": "TVEpisode",
            "name": "JUJUTSU KAISEN 0 | JUJUTSU KAISEN 0",
            "episodeNumber": 1,
            "url": "https://www.crunchyroll.com/watch/G4VUQ9ZQ3/jujutsu-kaisen-0",
            "partOfSeason": {
              "@type": "TVSeason",
              "name": "JUJUTSU KAISEN 0",
              "seasonNumber": 0
            },
            "partOfSeries": {
              "@type": "TVSeries",
              "name": "JUJUTSU KAISEN 0",
              "@id": "https://www.crunchyroll.com/series/GMTE00194450/jujutsu-kaisen-0"
            }
          }
        </script>
        <h1>JUJUTSU KAISEN 0</h1>
      `,
      "JUJUTSU KAISEN 0 JUJUTSU KAISEN 0 - Watch on Crunchyroll",
    );

    expect(
      parseEpisodePage(
        document,
        new URL("https://www.crunchyroll.com/watch/G4VUQ9ZQ3/jujutsu-kaisen-0"),
        60,
      ),
    ).toMatchObject({
      seriesTitle: "JUJUTSU KAISEN 0",
      seasonNumber: "JUJUTSU KAISEN 0",
      episodeNumber: "1",
      episodeTitle: "JUJUTSU KAISEN 0",
    });
  });

  it("returns null until required SPA metadata has rendered", () => {
    const document = makeDocument("<main>Loading…</main>", "Crunchyroll");

    expect(
      parseEpisodePage(
        document,
        new URL(
          "https://www.crunchyroll.com/watch/GRQW9GW7R/the-storm-dragon-veldora",
        ),
      ),
    ).toBeNull();
  });
});
