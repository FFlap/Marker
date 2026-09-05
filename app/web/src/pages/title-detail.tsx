import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ExternalLink, RefreshCw } from "lucide-react";
import {
  useMutation,
  usePaginatedQuery,
  useQuery as useConvexQuery,
} from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { AddTitleDialog, type SearchResult } from "@/components/title-dialog";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { posterUrl } from "@/lib/utils";

type Detail = SearchResult & {
  tmdbId?: number;
  voteAverage?: number;
  runtime?: number;
  episodeRunTime?: number[];
  genres?: string[];
  cast?: Array<{ name: string; character: string; profilePath?: string }>;
  seasons?: Array<{ season: number; name: string; episodeCount: number }>;
  firstAirDate?: string;
  metadataProvider?: "tmdb" | "tvdb";
};

type SeasonPage = {
  season: number;
  totalCount: number;
  chunkIndex: number;
  episodes: Array<{
    season: number;
    episode: number;
    name: string;
    overview?: string;
    runtime?: number;
    imageUrl?: string;
    airDate?: string;
  }>;
};

function parsePreview(value: string | undefined): SearchResult | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<SearchResult>;
    if (
      typeof parsed.id !== "number" ||
      typeof parsed.title !== "string" ||
      (parsed.mediaType !== "movie" && parsed.mediaType !== "tv")
    )
      return undefined;
    return {
      id: parsed.id,
      title: parsed.title,
      mediaType: parsed.mediaType,
      ...(typeof parsed.posterPath === "string" && { posterPath: parsed.posterPath }),
      ...(typeof parsed.overview === "string" && { overview: parsed.overview }),
      ...(typeof parsed.releaseDate === "string" && { releaseDate: parsed.releaseDate }),
      ...(typeof parsed.runtime === "number" && Number.isFinite(parsed.runtime) && { runtime: parsed.runtime }),
      ...(Array.isArray(parsed.genres) && parsed.genres.every((genre) => typeof genre === "string") && { genres: parsed.genres }),
    };
  } catch {
    return undefined;
  }
}

export function TitleDetailPage() {
  const { mediaType: rawMediaType, tmdbId: rawTmdbId } = useParams({
    from: "/app/title/$mediaType/$tmdbId",
  });
  const { preview: rawPreview } = useSearch({
    from: "/app/title/$mediaType/$tmdbId",
  });
  const navigate = useNavigate();
  const handleAdded = (itemId: string) => {
    void navigate({ to: "/item/$itemId", params: { itemId } });
  };
  const mediaType =
    rawMediaType === "movie" || rawMediaType === "tv"
      ? rawMediaType
      : undefined;
  const tmdbId = Number(rawTmdbId);
  const valid = Boolean(mediaType && Number.isInteger(tmdbId) && tmdbId > 0);
  const preview = useMemo(() => {
    const parsed = parsePreview(rawPreview);
    return parsed?.id === tmdbId && parsed.mediaType === mediaType
      ? parsed
      : undefined;
  }, [mediaType, rawPreview, tmdbId]);
  const existing = useConvexQuery(
    api.library.items.getOwnedItemByTmdb,
    mediaType && valid ? { mediaType, tmdbId } : "skip",
  );
  const titleView = useConvexQuery(
    api.resolvedMetadata.reads.getTitleView,
    mediaType && valid ? { mediaType, tmdbId } : "skip",
  );
  const titleRequestState = useConvexQuery(
    api.resolvedMetadata.reads.getTitleRequestState,
    mediaType && valid ? { mediaType, tmdbId } : "skip",
  );
  const touchTitle = useMutation(api.resolvedMetadata.touch.touchTitle);
  const detail = titleView?.title as Detail | null | undefined;
  const meta = detail ?? preview;
  const [season, setSeason] = useState(1);
  const [touchError, setTouchError] = useState(false);
  const [expandedEpisode, setExpandedEpisode] = useState<string>();
  const seasonView = usePaginatedQuery(
    api.resolvedMetadata.reads.getSeasonView,
    mediaType === "tv" && valid ? { tmdbId, season } : "skip",
    { initialNumItems: 1 },
  );
  const seasonPages = seasonView.results as SeasonPage[];
  const seasonRequestState = useConvexQuery(
    api.resolvedMetadata.reads.getSeasonRequestState,
    mediaType === "tv" && valid ? { tmdbId, season } : "skip",
  );
  const episodes = useMemo(
    () =>
      seasonPages
        .filter((page) => page.season === season)
        .toSorted((left, right) => left.chunkIndex - right.chunkIndex)
        .flatMap((page) => page.episodes),
    [season, seasonPages],
  );

  useEffect(() => {
    if (!mediaType || !valid) return undefined;
    let active = true;
    setTouchError(false);
    void touchTitle({
      mediaType,
      tmdbId,
      ...(preview?.title && { title: preview.title }),
      ...(mediaType === "tv" && { season }),
    }).catch(() => {
      if (active) setTouchError(true);
    });
    return () => {
      active = false;
    };
  }, [mediaType, preview?.title, season, tmdbId, touchTitle, valid]);

  useEffect(() => {
    if (existing) {
      void navigate({
        to: "/item/$itemId",
        params: { itemId: String(existing._id) },
        replace: true,
      });
    }
  }, [existing, navigate]);

  useEffect(() => {
    const available =
      detail?.seasons?.filter((entry) => entry.season >= 0) ?? [];
    const first =
      available.find((entry) => entry.season > 0)?.season ??
      available[0]?.season;
    if (
      first !== undefined &&
      !available.some((entry) => entry.season === season)
    )
      setSeason(first);
  }, [detail?.seasons, season]);

  if (!valid) {
    return (
      <Page width="compact">
        <PageHeader title="Details" back backFallback="/explore" />
        <p className="mt-20 text-center text-sm text-muted-foreground">
          Title not found.
        </p>
      </Page>
    );
  }

  const seasons = detail?.seasons?.filter((entry) => entry.season >= 0) ?? [];
  const releaseDate =
    detail?.releaseDate ?? detail?.firstAirDate ?? preview?.releaseDate;
  const runtime =
    detail?.runtime ?? detail?.episodeRunTime?.find((value) => value > 0);
  const titleFailed =
    !detail &&
    (touchError ||
      titleRequestState?.state === "failed" ||
      titleRequestState?.state === "notFound");
  const seasonFailed =
    !seasonPages.length &&
    (touchError ||
      seasonRequestState?.state === "failed" ||
      seasonRequestState?.state === "notFound");
  const selection: SearchResult | undefined = meta
    ? {
        id: tmdbId,
        mediaType: mediaType!,
        title: meta.title,
        posterPath: meta.posterPath,
        overview: meta.overview,
        releaseDate: meta.releaseDate ?? detail?.firstAirDate,
        runtime,
        genres: detail?.genres ?? [],
      }
    : undefined;

  return (
    <Page width="wide" className="max-w-4xl">
      <PageHeader title="Details" back backFallback="/explore" />
      {!meta && titleFailed ? (
        <div className="mt-16 text-center">
          <p className="text-sm font-semibold">
            Title details couldn’t be loaded
          </p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => {
              if (!mediaType) return;
              setTouchError(false);
              void touchTitle({
                mediaType,
                tmdbId,
                ...(preview?.title && { title: preview.title }),
                ...(mediaType === "tv" && { season }),
                force: true,
              }).catch(() => setTouchError(true));
            }}
          >
            <RefreshCw className="size-4" /> Retry
          </Button>
        </div>
      ) : !meta ? (
        <div className="mt-8 h-80 animate-pulse rounded-2xl bg-card" />
      ) : (
        <>
          <section className="mt-6 grid gap-6 sm:grid-cols-[180px_1fr] sm:items-center sm:gap-8 lg:grid-cols-[200px_1fr]">
            <div className="aspect-[2/3] w-36 overflow-hidden rounded-xl bg-card sm:w-full">
              {meta.posterPath && (
                <img
                  src={posterUrl(meta.posterPath)}
                  alt={`${meta.title} poster`}
                  className="size-full object-cover"
                />
              )}
            </div>
            <div>
              <h2 className="text-[29px] font-bold leading-[33px] tracking-[-.6px]">
                {meta.title}
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {releaseDate?.slice(0, 4)}
              </p>
              {detail?.genres?.length ? (
                <div className="mt-5 flex flex-wrap gap-2.5">
                  {detail.genres.map((genre) => (
                    <span
                      key={genre}
                      className="inline-flex min-h-9 items-center rounded-full border border-border px-4 text-sm text-muted-foreground"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
          {meta.overview && (
            <p className="mt-9 text-[15px] leading-6 text-muted-foreground">
              {meta.overview}
            </p>
          )}
          <div className="mt-8 grid grid-cols-2 gap-4 border-y border-border py-6">
            <div>
              <span className="text-xs text-muted-foreground">Runtime</span>
              <strong className="mt-1.5 block text-base">
                {runtime === undefined ? "—" : `${Math.round(runtime)} min`}
              </strong>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Rating</span>
              <strong className="mt-1.5 block text-base">
                {detail?.voteAverage === undefined
                  ? "—"
                  : detail.voteAverage.toFixed(1)}
              </strong>
            </div>
          </div>
          {titleFailed && (
            <p className="mt-4 text-xs text-muted-foreground">
              Current preview shown; full metadata couldn’t be refreshed.
            </p>
          )}
          <section className="mt-10">
            <SectionHeader title="Your entry" />
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                This title isn’t in your library yet.
              </p>
              {selection && (
                <AddTitleDialog initialSelection={selection} onAdded={handleAdded}>
                  <Button variant="outline">
                    Add Entry
                  </Button>
                </AddTitleDialog>
              )}
            </div>
          </section>
          {detail?.cast?.length ? (
            <section className="mt-12">
              <SectionHeader title="Cast" />
              <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
                {detail.cast.map((person) => (
                  <div
                    key={`${person.name}:${person.character}`}
                    className="w-24 shrink-0"
                  >
                    <div className="aspect-[3/4] overflow-hidden rounded-xl bg-card">
                      {person.profilePath && (
                        <img
                          src={posterUrl(person.profilePath)}
                          alt=""
                          className="size-full object-cover"
                        />
                      )}
                    </div>
                    <strong className="mt-2 block truncate text-sm">
                      {person.name}
                    </strong>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {person.character}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {mediaType === "tv" && (
            <section className="mt-12">
              <SectionHeader title="Episodes" />
              {seasons.length ? (
                <>
                  <select
                    value={season}
                    onChange={(event) => setSeason(Number(event.target.value))}
                    className="mt-5 h-14 w-full rounded-[14px] border border-border bg-card px-5 text-base font-semibold"
                    aria-label="Season"
                  >
                    {seasons.map((entry) => (
                      <option key={entry.season} value={entry.season}>
                        {entry.name || `Season ${entry.season}`}
                      </option>
                    ))}
                  </select>
                  <div className="mt-4 flex justify-end">
                    {selection && (
                      <AddTitleDialog initialSelection={selection} onAdded={handleAdded}>
                        <Button variant="outline">
                          Add to track
                        </Button>
                      </AddTitleDialog>
                    )}
                  </div>
                </>
              ) : detail ? (
                <p className="mt-5 text-xs text-muted-foreground">
                  Episode guide unavailable
                </p>
              ) : null}
              {seasonFailed ? (
                <div className="mt-5 flex items-center justify-between gap-4 border-y border-border py-4">
                  <p className="text-xs text-muted-foreground">
                    Episodes couldn’t be loaded.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTouchError(false);
                      void touchTitle({
                        mediaType: "tv",
                        tmdbId,
                        title: meta.title,
                        season,
                        force: true,
                      }).catch(() => setTouchError(true));
                    }}
                  >
                    <RefreshCw className="size-4" /> Retry
                  </Button>
                </div>
              ) : seasonView.status === "LoadingFirstPage" ? (
                <div className="mt-4 grid gap-2">
                  {[0, 1, 2].map((key) => (
                    <div
                      key={key}
                      className="h-20 animate-pulse rounded-xl bg-card"
                    />
                  ))}
                </div>
              ) : !episodes.length ? (
                <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center">
                  <p className="text-sm font-semibold">No episodes available</p>
                </div>
              ) : (
                <div className="mt-2 divide-y divide-border">
                  {episodes.map((episode) => {
                    const key = `${episode.season}:${episode.episode}`;
                    const expanded = expandedEpisode === key;
                    return (
                      <div key={key} className="py-3">
                        <div className="grid min-h-28 w-full grid-cols-[96px_1fr_auto] items-center gap-4 py-4 sm:grid-cols-[112px_1fr_auto]">
                          <span className="aspect-video overflow-hidden rounded-lg bg-card">
                            {episode.imageUrl ? (
                              <img
                                src={episode.imageUrl}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              <span className="grid size-full place-items-center text-xs font-semibold tabular-nums text-muted-foreground">
                                EP {String(episode.episode).padStart(2, "0")}
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            aria-label={`View episode ${episode.episode}`}
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedEpisode(expanded ? undefined : key)
                            }
                            className="min-w-0 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                              <strong className="text-foreground">
                                EP {String(episode.episode).padStart(2, "0")}
                              </strong>
                              {episode.runtime ? (
                                <span>{episode.runtime} min</span>
                              ) : null}
                            </span>
                            <strong className="mt-1.5 block line-clamp-2 text-base">
                              {episode.name}
                            </strong>
                            {episode.overview && !expanded ? (
                              <span className="mt-1.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                                {episode.overview}
                              </span>
                            ) : null}
                          </button>
                          {selection ? (
                            <AddTitleDialog initialSelection={selection} onAdded={handleAdded}>
                              <Button
                                variant="outline"
                                size="icon"
                                aria-label={`Add title to track episode ${episode.episode}`}
                                className="rounded-full text-muted-foreground"
                              >
                                +
                              </Button>
                            </AddTitleDialog>
                          ) : (
                            <span className="grid size-10 place-items-center rounded-full border border-border text-muted-foreground">
                              +
                            </span>
                          )}
                        </div>
                        {expanded && (
                          <div className="ml-[112px] pb-4 text-xs leading-5 text-muted-foreground sm:ml-32">
                            {episode.overview && <p>{episode.overview}</p>}
                            {episode.airDate && (
                              <p className="mt-2">Aired {episode.airDate}</p>
                            )}
                            <p className="mt-2">
                              Add this title to rate, tag, or mark individual
                              episodes watched.
                            </p>
                            {selection && (
                              <AddTitleDialog initialSelection={selection} onAdded={handleAdded}>
                                <Button
                                  variant="outline"
                                  className="mt-3"
                                >
                                  Add Entry
                                </Button>
                              </AddTitleDialog>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {seasonView.status === "CanLoadMore" && (
                <Button
                  variant="outline"
                  className="mt-5 w-full"
                  onClick={() => seasonView.loadMore(1)}
                >
                  Load more episodes
                </Button>
              )}
              {detail?.metadataProvider === "tvdb" && (
                <a
                  href="https://thetvdb.com"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex min-h-11 items-center gap-1 py-2 text-[10px] text-muted-foreground hover:text-foreground sm:min-h-0 sm:py-0"
                >
                  Season and episode metadata by TheTVDB · artwork by TMDB where
                  available
                  <ExternalLink className="size-3" />
                </a>
              )}
            </section>
          )}
        </>
      )}
    </Page>
  );
}
