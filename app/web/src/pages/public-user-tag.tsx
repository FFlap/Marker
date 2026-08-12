import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { FilterDialog, type LibraryFilters } from "@/components/filter-dialog";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { Input } from "@/components/ui/input";
import { collectionGridWidth } from "@/lib/display-preferences";
import { matchesMediaType } from "@/lib/library-filters";
import { posterUrl } from "@/lib/utils";

type PublicTitle = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  status: "watched" | "watching" | "watchlist" | "dropped";
  rating?: number;
  rank: number;
  isAnime?: boolean;
};

const labels = {
  watched: "Watched",
  watching: "Watching",
  watchlist: "Watchlist",
  dropped: "Dropped",
};

export function PublicUserTagPage() {
  const { username, tag } = useParams({ from: "/app/u/$username/tags/$tag" });
  const collection = useQuery(api.tags.publicByUser, { username, tag });
  const library = useQuery(api.library.listItems, {});
  const settings = useQuery(api.settings.getSettings, {});
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LibraryFilters>({
    media: "all",
    status: "all",
    minimum: 0,
    tags: [],
  });
  const gridColumns = settings?.gridColumns ?? 3;
  const existing = useMemo(
    () =>
      new Map(
        (library ?? []).map((item) => [
          `${item.mediaType}:${item.tmdbId}`,
          String(item._id),
        ]),
      ),
    [library],
  );
  const titles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ((collection?.titles ?? []) as PublicTitle[]).filter(
      (title) =>
        (!query || title.title.toLocaleLowerCase().includes(query)) &&
        matchesMediaType(title, filters.media) &&
        (filters.status === "all" || title.status === filters.status) &&
        (!filters.minimum || (title.rating ?? -1) >= filters.minimum),
    );
  }, [collection, filters, search]);
  const filtersActive =
    Boolean(search.trim()) ||
    filters.media !== "all" ||
    filters.status !== "all" ||
    filters.minimum > 0;
  const watchedRank = useMemo(
    () =>
      new Map(
        ((collection?.titles ?? []) as PublicTitle[])
          .filter((title) => title.status === "watched")
          .toSorted((left, right) => left.rank - right.rank)
          .map((title, index) => [
            `${title.mediaType}:${title.tmdbId}`,
            index + 1,
          ]),
      ),
    [collection],
  );

  return (
    <Page width="wide" className="max-w-4xl">
      <PageHeader
        title={collection?.tag ?? tag}
        back
        backFallback={`/u/${username}`}
      />
      <div className="mt-6 flex gap-2">
        <Input
          aria-label={`Search ${username}'s ${tag} tag`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${tag}`}
          className="h-11 border-0 bg-card text-sm sm:h-9"
        />
        <FilterDialog value={filters} onChange={setFilters} />
      </div>
      {collection === undefined ? (
        <div className="mt-8 h-72 animate-pulse rounded-2xl bg-card" />
      ) : collection === null ? (
        <div className="mt-20 text-center">
          <LockKeyhole className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-4 text-sm font-semibold">Tag not available</p>
          <p className="mt-2 text-xs text-muted-foreground">
            This collection is private or no longer exists.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-12">
          {(["watched", "watching", "watchlist", "dropped"] as const).map(
            (status) => {
              if (filters.status !== "all" && filters.status !== status)
                return null;
              const entries = titles
                .filter((title) => title.status === status)
                .toSorted((left, right) => left.rank - right.rank);
              return (
                <section key={status}>
                  <SectionHeader
                    title={labels[status]}
                    count={entries.length}
                  />
                  {entries.length ? (
                    <div className="mt-4 flex flex-wrap gap-x-[3.5%] gap-y-[18px]">
                      {entries.map((title) => {
                        const itemId = existing.get(
                          `${title.mediaType}:${title.tmdbId}`,
                        );
                        const content = (
                          <>
                            <div className="aspect-[2/3] overflow-hidden rounded-xl bg-card">
                              {title.posterPath && (
                                <img
                                  src={posterUrl(title.posterPath)}
                                  alt=""
                                  className="size-full object-cover"
                                />
                              )}
                            </div>
                            <strong className="mt-2 block truncate text-xs">
                              {status === "watched"
                                ? `${watchedRank.get(`${title.mediaType}:${title.tmdbId}`) ?? entries.indexOf(title) + 1}. `
                                : ""}
                              {title.title}
                            </strong>
                          </>
                        );
                        return itemId ? (
                          <Link
                            key={`${title.mediaType}:${title.tmdbId}`}
                            to="/item/$itemId"
                            params={{ itemId }}
                            className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            style={{
                              width: collectionGridWidth[gridColumns],
                              flexBasis: collectionGridWidth[gridColumns],
                              flexGrow: 0,
                              flexShrink: 0,
                            }}
                          >
                            {content}
                          </Link>
                        ) : (
                          <Link
                            key={`${title.mediaType}:${title.tmdbId}`}
                            to="/title/$mediaType/$tmdbId"
                            params={{
                              mediaType: title.mediaType,
                              tmdbId: String(title.tmdbId),
                            }}
                            search={{
                              preview: JSON.stringify({
                                id: title.tmdbId,
                                mediaType: title.mediaType,
                                title: title.title,
                                posterPath: title.posterPath,
                                overview: title.overview,
                                releaseDate: title.releaseDate,
                              }),
                            }}
                            className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            style={{
                              width: collectionGridWidth[gridColumns],
                              flexBasis: collectionGridWidth[gridColumns],
                              flexGrow: 0,
                              flexShrink: 0,
                            }}
                          >
                            {content}
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-sm font-semibold">
                        {filtersActive ? "No matches" : "Nothing here yet"}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {filtersActive
                          ? "Try a broader filter."
                          : "No titles in this section."}
                      </p>
                    </div>
                  )}
                </section>
              );
            },
          )}
        </div>
      )}
    </Page>
  );
}
