import { useMemo, useState } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { gridWidth } from "@/lib/display-preferences";
import { posterUrl } from "@/lib/utils";

export function PublicTagPage() {
  const { tag } = useParams({ from: "/tag/$tag" });
  const { isAuthenticated } = useConvexAuth();
  const { cursor } = useSearch({ from: "/tag/$tag" });
  const collection = useQuery(api.tags.publicDetails, { tag, cursor });
  const library = useQuery(api.library.items.listItems, isAuthenticated ? {} : "skip");
  const settings = useQuery(api.settings.getSettings, isAuthenticated ? {} : "skip");
  const [search, setSearch] = useState("");
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
    return (collection?.titles ?? []).filter(
      (title) => !query || title.title.toLocaleLowerCase().includes(query),
    );
  }, [collection, search]);

  return (
    <Page width="wide" className="max-w-4xl">
      <PageHeader title={collection?.tag ?? tag} back backFallback="/explore" />
      <SearchField
        aria-label={`Search public ${tag} titles`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={`Search ${tag}`}
        className="mt-6 h-11 border-0 bg-card text-sm sm:h-9"
      />
      {collection === undefined ? (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div
              key={key}
              className="aspect-[2/3] animate-pulse rounded-xl bg-card"
            />
          ))}
        </div>
      ) : collection === null ? (
        <div className="mt-20 text-center">
          <p className="text-sm font-semibold">Public tag not found</p>
          <p className="mt-2 text-xs text-muted-foreground">
            This tag may have been made private.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-muted-foreground">
            {titles.length}{" "}
            {titles.length === 1 ? "title" : "titles"} on this page from{" "}
            {collection.contributorCount}{" "}
            {collection.contributorCount === 1 ? "person" : "people"}
          </p>
          {!titles.length ? (
            <div className="mt-16 text-center text-sm text-muted-foreground">No matching titles.</div>
          ) : <div className="mt-8 grid gap-12">
            {(["movie", "tv"] as const).map((mediaType) => {
              const entries = titles.filter(
                (title) => title.mediaType === mediaType,
              );
              if (!entries.length) return null;
              return (
                <section key={mediaType}>
                  <SectionHeader
                    title={mediaType === "movie" ? "Movies" : "TV Shows"}
                    count={entries.length}
                  />
                  <div className="mt-4 flex flex-wrap gap-x-[3.5%] gap-y-[18px]">
                    {entries.map((title) => {
                      const itemId = existing.get(
                        `${title.mediaType}:${title.tmdbId}`,
                      );
                      const className =
                        "group min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
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
                            {title.title}
                          </strong>
                        </>
                      );
                      return itemId ? (
                        <Link
                          key={`${title.mediaType}:${title.tmdbId}`}
                          to="/item/$itemId"
                          params={{ itemId }}
                          className={className}
                          style={{
                            width: gridWidth(gridColumns),
                            flexBasis: gridWidth(gridColumns),
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
                          className={className}
                          style={{
                            width: gridWidth(gridColumns),
                            flexBasis: gridWidth(gridColumns),
                            flexGrow: 0,
                            flexShrink: 0,
                          }}
                        >
                          {content}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>}
        </>
      )}
      {collection?.nextCursor ? (
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link
            to="/tag/$tag"
            params={{ tag }}
            search={{ cursor: collection.nextCursor }}
          >
            Next titles
          </Link>
        </Button>
      ) : null}
    </Page>
  );
}
