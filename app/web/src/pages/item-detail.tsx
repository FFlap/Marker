import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  Check,
  EllipsisVertical,
  ExternalLink,
  Film,
  RefreshCw,
} from "lucide-react";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";
import { EpisodeDialog } from "@/components/episode-dialog";
import {
  LibraryEntryControls,
  type EntryDraft,
} from "@/components/library-entry-controls";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { WebLibraryItem } from "@/types";
import { posterUrl } from "@/lib/utils";

type LibraryItem = WebLibraryItem & {
  tmdbId?: number;
  timesWatched?: number;
  genres?: string[];
  runtime?: number;
};

type TitleDetail = {
  title?: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  firstAirDate?: string;
  runtime?: number;
  episodeRunTime?: number[];
  genres?: string[];
  seasons?: Array<{ season: number; name: string; episodeCount: number }>;
  cast?: Array<{ name: string; character: string; profilePath?: string }>;
  metadataProvider?: "tmdb" | "tvdb";
  orderEpoch?: number;
};

type SeasonPage = {
  season: number;
  totalCount: number;
  chunkIndex: number;
  metadataProvider: "tmdb" | "tvdb";
  orderEpoch: number;
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

function EntryDialog({
  item,
  onRemoved,
  children,
}: {
  item: LibraryItem;
  onRemoved: () => void;
  children: ReactNode;
}) {
  const updateItem = useMutation(api.library.items.updateItem);
  const removeItem = useMutation(api.library.items.removeItem);
  const moveItemToWatched = useAction(api.library.seasonWatched.moveItemToWatched);
  const [open, setOpen] = useState(false);
  const suggestions = useQuery(
    api.library.items.listTagSuggestions,
    !open ? "skip" : {},
  );
  const [draft, setDraft] = useState<EntryDraft>({
    status: item.status,
    rating: item.rating,
    timesWatched: item.timesWatched ?? (item.status === "watched" ? 1 : 0),
    tags: item.tags,
  });
  const [busy, setBusy] = useState<"save" | "remove">();
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) return;
    setDraft({
      status: item.status,
      rating: item.rating,
      timesWatched: item.timesWatched ?? (item.status === "watched" ? 1 : 0),
      tags: item.tags,
    });
    setError("");
  }, [item, open]);

  const save = async () => {
    setBusy("save");
    setError("");
    try {
      await updateItem({
        itemId: item._id as Id<"items">,
        ...(item.mediaType !== "tv" || draft.status !== "watched"
          ? { status: draft.status }
          : {}),
        timesWatched: draft.timesWatched,
        ...(draft.rating === undefined
          ? { clearRating: true }
          : { rating: draft.rating }),
        tags: draft.tags,
      });
      if (item.mediaType === "tv" && draft.status === "watched")
        await moveItemToWatched({ itemId: item._id as Id<"items"> });
      setOpen(false);
    } catch {
      setError("Couldn’t save this entry. Try again.");
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${item.title} and its episode history?`))
      return;
    setBusy("remove");
    try {
      await removeItem({ itemId: item._id as Id<"items"> });
      setOpen(false);
      onRemoved();
    } catch {
      setError("Couldn’t remove this title. Try again.");
      setBusy(undefined);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return;
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogTitle>Edit entry</DialogTitle>
        <LibraryEntryControls
          value={draft}
          suggestions={suggestions ?? []}
          onChange={setDraft}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between border-t border-border pt-5">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={Boolean(busy)}
            onClick={() => void remove()}
          >
            {busy === "remove" ? "Removing…" : "Remove from library"}
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ItemDetailPage() {
  const { itemId } = useParams({ from: "/app/item/$itemId" });
  const navigate = useNavigate();
  const listQuery = useQuery(api.library.items.listItems, {});
  const touchItemView = useMutation(api.resolvedMetadata.touch.touchItemView);
  const setSeasonWatched = useAction(api.library.seasonWatched.setSeasonWatched);
  const itemView = useQuery(
    api.resolvedMetadata.reads.getItemView,
    { itemId: itemId as Id<"items"> },
  );
  const item = (itemView?.item ??
    listQuery?.find((entry) => String(entry._id) === itemId)) as LibraryItem | undefined;
  const title = itemView?.title as TitleDetail | null | undefined;
  const seasons = useMemo(
    () => title?.seasons?.filter((entry) => entry.season >= 0) ?? [],
    [title?.seasons],
  );
  const [season, setSeason] = useState(1);
  const [expandedEpisode, setExpandedEpisode] = useState<string>();
  const [episodePending, setEpisodePending] = useState<string>();
  const setEpisodeState = useMutation(api.library.episodes.setEpisodeState);
  const seasonView = usePaginatedQuery(
    api.resolvedMetadata.reads.getSeasonView,
    item?.mediaType === "tv" && item.tmdbId !== undefined
      ? { tmdbId: item.tmdbId, season }
      : "skip",
    { initialNumItems: 1 },
  );
  const savedEpisodes = useQuery(
    api.library.episodes.listEpisodes,
    item?.mediaType === "tv"
      ? { itemId: item._id as Id<"items">, season, pageCount: 20 }
      : "skip",
  );
  const episodeProgress = useQuery(
    api.library.episodes.listEpisodeProgress,
    item?.mediaType === "tv"
      ? { itemId: item._id as Id<"items"> }
      : "skip",
  );
  const titleRequestState = useQuery(
    api.resolvedMetadata.reads.getTitleRequestState,
    item?.tmdbId !== undefined
      ? { mediaType: item.mediaType, tmdbId: item.tmdbId }
      : "skip",
  );
  const seasonRequestState = useQuery(
    api.resolvedMetadata.reads.getSeasonRequestState,
    item?.mediaType === "tv" && item.tmdbId !== undefined
      ? { tmdbId: item.tmdbId, season }
      : "skip",
  );
  const seasonPages = seasonView.results as SeasonPage[];
  const episodes = useMemo(
    () =>
      seasonPages
        .filter((page) => page.season === season)
        .toSorted((left, right) => left.chunkIndex - right.chunkIndex)
        .flatMap((page) => page.episodes),
    [season, seasonPages],
  );
  const savedByEpisode = useMemo(
    () =>
      new Map(
        (savedEpisodes ?? []).map((entry) => [
          entry.episode,
          entry as { watched?: boolean; rating?: number; tags?: string[] },
        ]),
      ),
    [savedEpisodes],
  );
  const seasonRow = seasonPages.find((page) => page.season === season);
  const watchedSeasonCount =
    episodeProgress?.find((entry) => entry.season === season)
      ?.currentWatchedCount ?? 0;
  const seasonFullyWatched =
    (seasonRow?.totalCount ?? 0) > 0 &&
    watchedSeasonCount >= (seasonRow?.totalCount ?? 0);
  const [seasonPending, setSeasonPending] = useState(false);
  const [seasonActionError, setSeasonActionError] = useState("");
  const [metadataActionError, setMetadataActionError] = useState("");
  const [episodeActionError, setEpisodeActionError] = useState("");
  const touchItemId = item?._id as Id<"items"> | undefined;
  const touchMediaType = item?.mediaType;

  useEffect(() => {
    if (!touchItemId || !touchMediaType) return;
    void touchItemView({
      itemId: touchItemId,
      ...(touchMediaType === "tv" && { season }),
    }).catch(() => undefined);
  }, [season, touchItemId, touchItemView, touchMediaType]);

  useEffect(() => {
    const first =
      seasons.find((entry) => entry.season > 0)?.season ?? seasons[0]?.season;
    if (
      first !== undefined &&
      !seasons.some((entry) => entry.season === season)
    )
      setSeason(first);
  }, [season, seasons]);

  if (itemView === undefined || (!item && listQuery === undefined)) {
    return (
      <Page width="compact">
        <PageHeader title="Details" back />
        <div className="mt-8 h-72 animate-pulse rounded-2xl bg-card" />
      </Page>
    );
  }
  if (!item) {
    return (
      <Page width="compact">
        <PageHeader title="Details" back />
        <p className="mt-20 text-center text-sm text-muted-foreground">
          Title not found.
        </p>
      </Page>
    );
  }

  const meta = {
    title: title?.title ?? item.title,
    posterPath: title?.posterPath ?? item.posterPath,
    overview: title?.overview ?? item.overview,
    releaseDate: title?.releaseDate ?? title?.firstAirDate ?? item.releaseDate,
    genres: title?.genres ?? item.genres ?? [],
    cast: title?.cast ?? [],
  };
  const overview = meta.overview;
  const releaseDate = meta.releaseDate;
  const genres = meta.genres;
  const runtime =
    title?.runtime ??
    title?.episodeRunTime?.find((value) => value > 0) ??
    item.runtime;
  const titleFailed =
    !title &&
    (titleRequestState?.state === "failed" ||
      titleRequestState?.state === "notFound");
  const seasonFailed =
    !seasonRow &&
    (seasonRequestState?.state === "failed" ||
      seasonRequestState?.state === "notFound");
  const visibleSeasons = seasons;
  const visibleEpisodes = episodes;

  return (
    <Page width="wide" className="max-w-5xl">
      <PageHeader title="Details" back />

      <section className="mt-6 grid gap-6 sm:grid-cols-[180px_1fr] sm:items-center sm:gap-8 lg:grid-cols-[200px_1fr] lg:gap-10">
        <div className="aspect-[2/3] w-36 overflow-hidden rounded-xl bg-card sm:w-full">
          {meta.posterPath && (
            <img
              src={posterUrl(meta.posterPath)}
              alt={`${meta.title} poster`}
              className="size-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0">
          <h2 className="text-[29px] font-bold leading-[33px] tracking-[-.6px]">
            {meta.title}
          </h2>
          {(releaseDate || runtime) && (
            <p className="mt-3 text-sm text-muted-foreground">
              {[
                releaseDate?.slice(0, 4),
                item.mediaType === "movie" && runtime
                  ? `${runtime} min`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {genres.map((genre) => (
              <span
                key={genre}
                className="inline-flex min-h-9 items-center rounded-full border border-border px-4 text-sm text-muted-foreground"
              >
                {genre}
              </span>
            ))}
          </div>
        </div>
      </section>

      {overview && (
        <section className="mt-9">
          <p className="text-[15px] leading-6 text-muted-foreground">
            {overview}
          </p>
        </section>
      )}

      {titleFailed && (
        <div className="mt-8 flex items-center justify-between gap-4 border-y border-border py-4">
          <p className="text-xs text-muted-foreground">
            Title details couldn’t be loaded.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMetadataActionError("");
              void touchItemView({
                itemId: item._id as Id<"items">,
                ...(item.mediaType === "tv" && { season }),
                force: true,
              }).catch(() => setMetadataActionError("Couldn’t retry loading title details."));
            }}
          >
            <RefreshCw className="size-4" /> Retry
          </Button>
        </div>
      )}
      {metadataActionError ? <p role="alert" className="mt-3 text-xs text-destructive">{metadataActionError}</p> : null}

      <section className="mt-10">
        <SectionHeader title="Your entry" />
        <div className="mt-6 grid grid-cols-3 gap-5">
          <div>
            <span className="text-xs font-semibold text-muted-foreground">
              Status
            </span>
            <strong className="mt-1.5 block text-base capitalize">
              {item.status}
            </strong>
          </div>
          <div>
            <span className="text-xs font-semibold text-muted-foreground">
              Rating
            </span>
            <strong className="mt-1.5 block text-base">
              {item.rating === undefined ? "Not rated" : item.rating.toFixed(1)}
            </strong>
          </div>
          <div>
            <span className="text-xs font-semibold text-muted-foreground">
              Watched
            </span>
            <strong className="mt-1.5 block text-base">
              {item.timesWatched ?? 0}×
            </strong>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {item.tags.length ? (
            item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">No tags</span>
          )}
        </div>
        <EntryDialog item={item} onRemoved={() => void navigate({ to: "/" })}>
          <Button
            variant="outline"
            className="mt-7 h-12 w-full"
            aria-label="Edit library entry"
          >
            Update entry
          </Button>
        </EntryDialog>
      </section>

      {meta.cast.length > 0 && (
        <section className="mt-12">
          <SectionHeader title="Cast" />
          <div className="mt-5 flex gap-5 overflow-x-auto pb-3">
            {meta.cast.map((person) => (
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
                <strong className="mt-2.5 block truncate text-sm">
                  {person.name}
                </strong>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {person.character}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {item.mediaType === "tv" && (
        <section className="mt-12">
          <SectionHeader title="Episodes" />
          {visibleSeasons.length > 0 && (
            <select
              aria-label="Season"
              value={season}
              onChange={(event) => setSeason(Number(event.target.value))}
              className="mt-5 h-14 w-full rounded-[14px] border border-border bg-card px-5 text-base font-semibold"
            >
              {visibleSeasons.map((entry) => (
                <option key={entry.season} value={entry.season}>
                  {entry.name || `Season ${entry.season}`}
                </option>
              ))}
            </select>
          )}
          {seasonRow && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {seasonRow.totalCount > 0
                  ? `${watchedSeasonCount} of ${seasonRow.totalCount} watched`
                  : "No episodes"}
              </span>
              <Button
                variant="outline"
                className="h-11 px-5"
                disabled={seasonPending || !episodes.length}
                onClick={() => {
                  const watched = !seasonFullyWatched;
                  setSeasonPending(true);
                  setSeasonActionError("");
                  void setSeasonWatched({
                    itemId: item._id as Id<"items">,
                    season,
                    watched,
                    orderEpoch: seasonRow.orderEpoch,
                    metadataProvider: seasonRow.metadataProvider,
                  })
                    .catch(() =>
                      setSeasonActionError("Couldn’t update this season."),
                    )
                    .finally(() => setSeasonPending(false));
                }}
              >
                {seasonPending
                  ? "Saving…"
                  : seasonFullyWatched
                    ? "Mark unwatched"
                    : "Mark watched"}
              </Button>
            </div>
          )}
          {seasonActionError && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {seasonActionError}
            </p>
          )}
          {seasonFailed ? (
            <div className="mt-5 flex items-center justify-between gap-4 border-y border-border py-4">
              <p className="text-xs text-muted-foreground">
                Episodes couldn’t be loaded.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMetadataActionError("");
                  void touchItemView({
                    itemId: item._id as Id<"items">,
                    season,
                    force: true,
                  }).catch(() => setMetadataActionError("Couldn’t retry loading episodes."));
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
          ) : visibleEpisodes.length ? (
            <div className="mt-5 divide-y divide-border">
              {visibleEpisodes.map((episode) => {
                const saved = savedByEpisode.get(episode.episode);
                const key = `${episode.season}:${episode.episode}`;
                const expanded = expandedEpisode === key;
                const episodeView = {
                  itemId: String(item._id),
                  title: item.title,
                  seasonName:
                    seasons.find((entry) => entry.season === episode.season)
                      ?.name ?? `Season ${episode.season}`,
                  season: episode.season,
                  episode: episode.episode,
                  name: episode.name,
                  overview:
                    "overview" in episode ? episode.overview : undefined,
                  runtime: "runtime" in episode ? episode.runtime : undefined,
                  imageUrl:
                    "imageUrl" in episode ? episode.imageUrl : undefined,
                  airDate: "airDate" in episode ? episode.airDate : undefined,
                  rating: saved?.rating,
                  tags: saved?.tags ?? [],
                  watched: saved?.watched ?? false,
                };
                return (
                  <div key={key} className="py-3">
                    <div className="grid min-h-28 w-full grid-cols-[96px_1fr_auto] items-center gap-4 py-3 sm:grid-cols-[112px_1fr_auto]">
                      <span className="aspect-video overflow-hidden rounded-xl bg-card">
                        {"imageUrl" in episode && episode.imageUrl ? (
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
                        <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                          <strong className="font-semibold text-foreground">
                            EP {String(episode.episode).padStart(2, "0")}
                          </strong>
                          {"runtime" in episode && episode.runtime && (
                            <span>{episode.runtime} min</span>
                          )}
                        </span>
                        <strong className="mt-1.5 block truncate text-base">
                          {episode.name}
                        </strong>
                        {"overview" in episode &&
                        episode.overview &&
                        !expanded ? (
                          <span className="mt-1.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                            {episode.overview}
                          </span>
                        ) : null}
                      </button>
                      {saved?.watched ? (
                        <EpisodeDialog episode={episodeView}>
                          <button
                            type="button"
                            aria-label={`Episode ${episode.episode} options`}
                            className="grid size-11 place-items-center rounded-full border border-border text-muted-foreground transition hover:text-foreground sm:size-8"
                          >
                            <EllipsisVertical className="size-4" />
                          </button>
                        </EpisodeDialog>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Mark episode ${episode.episode} watched`}
                          disabled={episodePending === key}
                          onClick={() => {
                            setEpisodePending(key);
                            setEpisodeActionError("");
                            void setEpisodeState({
                              itemId: item._id as Id<"items">,
                              season: episode.season,
                              episode: episode.episode,
                              seasonName: episodeView.seasonName,
                              name: episode.name,
                              ...(episodeView.overview !== undefined && {
                                overview: episodeView.overview,
                              }),
                              ...(episodeView.runtime !== undefined && {
                                runtime: episodeView.runtime,
                              }),
                              ...(episodeView.imageUrl !== undefined && {
                                imageUrl: episodeView.imageUrl,
                              }),
                              ...(episodeView.airDate !== undefined && {
                                airDate: episodeView.airDate,
                              }),
                              watched: true,
                            })
                              .catch(() => setEpisodeActionError("Couldn’t mark that episode watched."))
                              .finally(() => setEpisodePending(undefined));
                          }}
                          className="grid size-11 place-items-center rounded-full border border-border text-muted-foreground transition hover:bg-foreground hover:text-background disabled:opacity-50 sm:size-8"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                    </div>
                    {expanded ? (
                      <div className="rounded-xl bg-card p-4 text-sm leading-6 text-muted-foreground">
                        {episodeView.overview ? (
                          <p className="text-foreground">
                            {episodeView.overview}
                          </p>
                        ) : null}
                        {episodeView.airDate ? (
                          <p className="mt-2">Aired {episodeView.airDate}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center">
              <Film className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">
                No episodes available
              </p>
            </div>
          )}
          {episodeActionError && <p role="alert" className="mt-3 text-xs text-destructive">{episodeActionError}</p>}
          {seasonView.status === "CanLoadMore" && (
            <Button
              variant="outline"
              className="mt-5 w-full"
              onClick={() => seasonView.loadMore(1)}
            >
              Load more episodes
            </Button>
          )}
          {title?.metadataProvider === "tvdb" && (
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
    </Page>
  );
}
