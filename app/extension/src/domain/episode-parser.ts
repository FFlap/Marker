import { DateTime, Effect, Exit, Option, Schema } from "effect";
import type { EpisodeBookmark } from "./types";

const WATCH_PATH = /^\/watch\/([A-Z0-9]+)\/([^/?#]+)/i;
const SERIES_PATH = /^\/series\/([A-Z0-9]+)\/([^/?#]+)/i;
const EPISODE_HEADING = /^E([A-Z0-9.-]+)\s*-\s*(.+)$/i;
const SEASON_TITLE = /\bSeason\s+([A-Z0-9.-]+)/i;
const CRUNCHYROLL_ORIGINS = new Set([
  "https://www.crunchyroll.com",
  "https://crunchyroll.com",
]);

interface StructuredEpisode {
  episodeNumber?: string;
  episodeTitle?: string;
  season?: string;
  seriesTitle?: string;
  seriesUrl?: string;
  watchUrl?: string;
}

const metadataField = <S extends Schema.Constraint>(schema: S) =>
  Schema.catchDecoding<Schema.optional<S>>(() => Effect.succeed(Option.none()))(
    Schema.optional(schema),
  );
const MetadataText = Schema.Trim.check(Schema.isMinLength(1));
const MetadataCoordinate = Schema.Union([
  Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  MetadataText,
]);
const StructuredEpisodeSchema = Schema.Struct({
  "@type": Schema.Literal("TVEpisode"),
  name: metadataField(MetadataText),
  episodeNumber: metadataField(MetadataCoordinate),
  url: metadataField(MetadataText),
  partOfSeason: metadataField(Schema.Struct({
    name: metadataField(MetadataText),
    seasonNumber: metadataField(MetadataCoordinate),
  })),
  partOfSeries: metadataField(Schema.Struct({
    name: metadataField(MetadataText),
    "@id": metadataField(MetadataText),
  })),
});
const decodeJson = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));
const decodeStructuredEpisode = Schema.decodeUnknownExit(StructuredEpisodeSchema);

function normalizeSeasonName(
  name: string | undefined,
  seasonNumber: string | number | undefined,
  seriesName: string | undefined,
) {
  if (name) {
    const numberedName = /^Season\s+(.+)$/i.exec(name)?.[1];
    if (numberedName) return numberedName.trim();

    if (Number(seasonNumber) === 0) return name;

    const isSeriesDerivedVariant =
      seriesName && name.startsWith(seriesName);

    if (!isSeriesDerivedVariant) return name;
  }
  if (seasonNumber !== undefined) {
    return String(seasonNumber);
  }
  return undefined;
}

function parseStructuredEpisode(document: Document): StructuredEpisode | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    const data = decodeJson(script.textContent ?? "");
    if (Exit.isFailure(data)) continue;
    const entries = Array.isArray(data.value) ? data.value : [data.value];
    for (const entry of entries) {
      const decoded = decodeStructuredEpisode(entry);
      if (Exit.isFailure(decoded)) continue;
      const record = decoded.value;
      const nameAfterSeparator = /\|\s*(.+)$/
        .exec(record.name ?? "")?.[1]
        ?.trim();
      const episodeFromName = nameAfterSeparator
        ? (EPISODE_HEADING.exec(nameAfterSeparator)?.[2] ?? nameAfterSeparator)
        : undefined;

      return {
        episodeNumber: record.episodeNumber !== undefined
          ? String(record.episodeNumber)
          : undefined,
        episodeTitle: episodeFromName?.trim(),
        season: normalizeSeasonName(
          record.partOfSeason?.name,
          record.partOfSeason?.seasonNumber,
          record.partOfSeries?.name,
        ),
        seriesTitle: record.partOfSeries?.name,
        seriesUrl: record.partOfSeries?.["@id"],
        watchUrl: record.url,
      };
    }
  }
  return null;
}

function parseSeasonCategory(title: string, episodeTitle: string) {
  const numberedSeason = SEASON_TITLE.exec(title)?.[1];
  if (numberedSeason) return numberedSeason;

  const suffix = `${episodeTitle} - Watch on Crunchyroll`;
  if (!title.endsWith(suffix)) return null;
  return title.slice(0, -suffix.length).trim() || null;
}

function safeUrl(value: string, base: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

export function parseWatchPath(pathname: string) {
  const match = WATCH_PATH.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return { episodeId: match[1] };
}

export function parseEpisodePage(
  document: Document,
  url: URL,
  updatedAt = DateTime.toEpochMillis(DateTime.nowUnsafe()),
): EpisodeBookmark | null {
  if (!CRUNCHYROLL_ORIGINS.has(url.origin)) return null;
  const watch = parseWatchPath(url.pathname);
  if (!watch) return null;

  const structured = parseStructuredEpisode(document);
  const structuredWatchUrl = structured?.watchUrl
    ? safeUrl(structured.watchUrl, url.origin)
    : null;
  if (
    structuredWatchUrl &&
    (!CRUNCHYROLL_ORIGINS.has(structuredWatchUrl.origin) ||
      structuredWatchUrl.pathname !== url.pathname)
  ) {
    return null;
  }
  const seriesLink = Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).find((link) => {
    const href = safeUrl(link.getAttribute("href") ?? link.href, url.origin);
    return href
      ? CRUNCHYROLL_ORIGINS.has(href.origin) && SERIES_PATH.test(href.pathname)
      : false;
  });
  const heading = document.querySelector<HTMLHeadingElement>("h1");
  const episode = EPISODE_HEADING.exec(heading?.textContent?.trim() ?? "");
  const episodeNumber = structured?.episodeNumber ?? episode?.[1];
  const episodeTitle = structured?.episodeTitle ?? episode?.[2]?.trim();
  const season =
    structured?.season ??
    (episodeTitle ? parseSeasonCategory(document.title, episodeTitle) : null);

  const structuredSeriesUrl = structured?.seriesUrl
    ? safeUrl(structured.seriesUrl, url.origin)
    : null;
  if (
    structuredSeriesUrl &&
    !CRUNCHYROLL_ORIGINS.has(structuredSeriesUrl.origin)
  )
    return null;
  const seriesUrl =
    structuredSeriesUrl ??
    (seriesLink
      ? safeUrl(seriesLink.getAttribute("href") ?? seriesLink.href, url.origin)
      : null);
  if (!seriesUrl || !episodeNumber || !episodeTitle || !season) return null;
  const series = SERIES_PATH.exec(seriesUrl.pathname);
  const seriesTitle =
    structured?.seriesTitle ?? seriesLink?.textContent?.trim();
  if (!series?.[1] || !seriesTitle) return null;

  return {
    platform: "crunchyroll",
    seriesId: series[1],
    seriesTitle,
    seriesUrl: `${seriesUrl.origin}${seriesUrl.pathname}`,
    seasonNumber: season,
    episodeNumber,
    episodeTitle,
    episodeId: watch.episodeId,
    watchUrl: `${(structuredWatchUrl ?? url).origin}${(structuredWatchUrl ?? url).pathname}`,
    updatedAt,
  };
}
