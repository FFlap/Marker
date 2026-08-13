import { useEffect, useMemo, useState } from "react";
import { Check, EllipsisVertical, SlidersHorizontal, Star } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { Id } from "../../../mobile/convex/_generated/dataModel";
import { ChipGroup } from "@/components/chip-group";
import { EpisodeDialog, type EpisodeView } from "@/components/episode-dialog";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Episode = EpisodeView & {
  posterPath?: string;
  imageUrl?: string;
  isAnime: boolean;
  tags: string[];
};

const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function useLocalToday() {
  const [today, setToday] = useState(localDateKey);
  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      setToday(localDateKey());
      const now = new Date();
      const nextDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      window.clearTimeout(timer);
      timer = window.setTimeout(
        refresh,
        Math.max(1_000, nextDay.getTime() - now.getTime() + 100),
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return today;
}

export function EpisodesPage() {
  const today = useLocalToday();
  const queried = useQuery(api.episodeHub.overview, { today });
  const setEpisode = useMutation(api.library.setEpisodeState);
  const data = queried as
    { watching: Episode[]; favorites: Episode[] } | undefined;
  const [tab, setTab] = useState<"watching" | "favorites">("watching");
  const [search, setSearch] = useState("");
  const [showType, setShowType] = useState<"all" | "anime" | "other">("all");
  const [minimumRating, setMinimumRating] = useState(0);
  const [tag, setTag] = useState("all");
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState("");
  const [expandedEpisode, setExpandedEpisode] = useState<string>();
  const favoriteTags = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const episode of data?.favorites ?? [])
      for (const entry of episode.tags) {
        const key = entry.toLocaleLowerCase();
        if (!byKey.has(key)) byKey.set(key, entry);
      }
    return [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .toSorted((left, right) => left.label.localeCompare(right.label));
  }, [data]);
  const episodes = useMemo(
    () =>
      (data?.[tab] ?? []).filter(
        (episode) =>
          `${episode.title} ${episode.name}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()) &&
          (showType === "all" ||
            (showType === "anime" ? episode.isAnime : !episode.isAnime)) &&
          (tab !== "favorites" || (episode.rating ?? 0) >= minimumRating) &&
          (tab !== "favorites" ||
            tag === "all" ||
            episode.tags.some((entry) => entry.toLocaleLowerCase() === tag)),
      ) as Episode[],
    [data, minimumRating, search, showType, tab, tag],
  );
  const filtersActive =
    showType !== "all" ||
    (tab === "favorites" && (minimumRating > 0 || tag !== "all"));
  return (
    <Page width="wide" className="max-w-5xl">
      <h1 className="sr-only">Episodes</h1>
      <div className="flex gap-2">
        <SearchField
          wrapperClassName="flex-1"
          aria-label={`Search ${tab} episodes`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={
            tab === "watching" ? "Search next episodes" : "Search favorites"
          }
        />
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-11 rounded-full border-0 bg-transparent hover:bg-transparent sm:size-9"
              aria-label="Episode filters"
            >
              <SlidersHorizontal className="size-[18px]" />
              {filtersActive && (
                <span className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" />
              )}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Episode filters</DialogTitle>
            <ChipGroup
              label="Show type"
              options={(["all", "anime", "other"] as const).map((value) => ({
                value,
                label:
                  value === "all"
                    ? "All"
                    : value === "anime"
                      ? "Anime"
                      : "Other TV",
              }))}
              value={showType}
              onChange={setShowType}
            />
            {tab === "favorites" && (
              <>
                <ChipGroup
                  label="Minimum rating"
                  options={[0, 8, 9, 10].map((value) => ({
                    value,
                    label: value ? `${value}+` : "Any",
                  }))}
                  value={minimumRating}
                  onChange={setMinimumRating}
                />
                <ChipGroup
                  label="Tags"
                  options={[
                    { value: "all", label: "All tags" },
                    ...favoriteTags.map(({ key, label }) => ({
                      value: key,
                      label,
                    })),
                  ]}
                  value={tag}
                  onChange={setTag}
                />
              </>
            )}
            {filtersActive && (
              <Button
                variant="ghost"
                onClick={() => {
                  setShowType("all");
                  setMinimumRating(0);
                  setTag("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </DialogContent>
        </Dialog>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as typeof tab);
          setSearch("");
          setShowType("all");
          setMinimumRating(0);
          setTag("all");
          setExpandedEpisode(undefined);
        }}
      >
        <TabsList className="mt-4 grid h-14 w-full grid-cols-2 rounded-none border-x-0 border-t-0 bg-transparent p-0">
          <TabsTrigger
            className="h-14 rounded-none border-b-2 border-transparent bg-transparent px-4 text-sm data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
            value="watching"
          >
            Watching
          </TabsTrigger>
          <TabsTrigger
            className="h-14 rounded-none border-b-2 border-transparent bg-transparent px-4 text-sm data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
            value="favorites"
          >
            Favorites
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-6 grid gap-3">
        {episodes.map((episode) => {
          const key = `${episode.itemId}:${episode.season}:${episode.episode}`;
          const expanded = expandedEpisode === key;
          return (
            <div key={key} className="border-b border-border py-3">
              <div className="grid min-h-[78px] grid-cols-[96px_1fr_auto] items-center gap-3 py-2 sm:grid-cols-[112px_1fr_auto]">
                <span className="aspect-video overflow-hidden rounded-lg bg-card">
                  {episode.imageUrl ? (
                    <img
                      src={episode.imageUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label={`View ${episode.title}, episode ${episode.episode}`}
                  aria-expanded={expanded}
                  onClick={() => setExpandedEpisode(expanded ? undefined : key)}
                  className="min-w-0 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="min-w-0 truncate text-[11px] font-semibold text-muted-foreground">
                      {episode.title}
                    </span>
                    {tab === "favorites" && episode.rating !== undefined ? (
                      <span
                        aria-label={`Rated ${episode.rating} out of 10`}
                        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground"
                      >
                        <Star className="size-3 fill-current" />
                        {episode.rating.toFixed(1)}
                      </span>
                    ) : null}
                  </span>
                  <strong className="mt-1.5 block line-clamp-2 text-sm">
                    {episode.name}
                  </strong>
                  {episode.overview && !expanded ? (
                    <span className="mt-1.5 block line-clamp-2 text-sm leading-5 text-muted-foreground">
                      {episode.overview}
                    </span>
                  ) : null}
                </button>
                {tab === "watching" ? (
                  <button
                    type="button"
                    aria-label={`Mark ${episode.title} episode ${episode.episode} watched`}
                    disabled={pending.has(key)}
                    onClick={() => {
                      setPending((current) => new Set(current).add(key));
                      setError("");
                      void setEpisode({
                        itemId: episode.itemId as Id<"items">,
                        season: episode.season,
                        episode: episode.episode,
                        seasonName: episode.seasonName,
                        name: episode.name,
                        ...(episode.overview !== undefined && {
                          overview: episode.overview,
                        }),
                        ...(episode.runtime !== undefined && {
                          runtime: episode.runtime,
                        }),
                        ...(episode.imageUrl !== undefined && {
                          imageUrl: episode.imageUrl,
                        }),
                        ...(episode.airDate !== undefined && {
                          airDate: episode.airDate,
                        }),
                        watched: true,
                      })
                        .catch(() => setError("Couldn’t mark that episode watched."))
                        .finally(() =>
                          setPending((current) => {
                            const next = new Set(current);
                            next.delete(key);
                            return next;
                          }),
                        );
                    }}
                    className="grid size-11 place-items-center rounded-full border border-border transition hover:bg-foreground hover:text-background disabled:opacity-50 sm:size-8"
                  >
                    <Check className="size-3.5" />
                  </button>
                ) : (
                  <EpisodeDialog episode={{ ...episode, watched: true }}>
                    <button
                      type="button"
                      aria-label={`${episode.title} episode ${episode.episode} options`}
                      className="grid size-11 place-items-center rounded-full border border-border text-muted-foreground transition hover:text-foreground sm:size-8"
                    >
                      <EllipsisVertical className="size-4" />
                    </button>
                  </EpisodeDialog>
                )}
              </div>
              {expanded ? (
                <div className="rounded-xl bg-card p-4 text-sm leading-6 text-muted-foreground">
                  {episode.overview ? (
                    <p className="text-foreground">{episode.overview}</p>
                  ) : null}
                  <div
                    className={
                      episode.overview
                        ? "mt-3 flex flex-wrap gap-x-4 gap-y-1"
                        : "flex flex-wrap gap-x-4 gap-y-1"
                    }
                  >
                    <span>EP {String(episode.episode).padStart(2, "0")}</span>
                    {episode.runtime ? (
                      <span>{episode.runtime} min</span>
                    ) : null}
                    {episode.airDate ? (
                      <span>Aired {episode.airDate}</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        {queried === undefined ? (
          ["one", "two", "three", "four"].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-2xl bg-card" />
          ))
        ) : !episodes.length && data ? (
          <div className="py-20 text-center">
            <p className="text-sm font-semibold">
              {tab === "watching"
                ? "Nothing queued"
                : "No favorite episodes yet"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {search || filtersActive
                ? "Try clearing your search or filters."
                : tab === "watching"
                  ? "Move a series into Watching to track its next episode here."
                  : "Rate watched episodes and your highest scores will appear here."}
            </p>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
