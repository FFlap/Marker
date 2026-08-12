import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Tags, UserRound } from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { SearchResult } from "@/components/title-dialog";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { posterUrl } from "@/lib/utils";

type Filter = "all" | "movie" | "tv" | "people" | "tags";
type MediaResult = SearchResult & { voteAverage?: number };
type Person = {
  username: string;
  isPublic: boolean;
  avatarUrl?: string;
  followerCount: number;
  followingCount: number;
  relationship: "self" | "none" | "pending" | "accepted";
};
type PublicTag = {
  tag: string;
  titleCount: number;
  contributorCount: number;
  posters: Array<{ title: string; posterPath?: string }>;
};

function MediaRow({
  item,
  itemId,
}: {
  item: MediaResult;
  itemId?: string;
}) {
  const content = (
    <>
      <div className="aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-lg bg-card">
        {item.posterPath && (
          <img
            src={posterUrl(item.posterPath)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        )}
      </div>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm">{item.title}</strong>
        <span className="mt-1 block text-xs text-muted-foreground">
          {item.releaseDate?.slice(0, 4) || "—"} ·{" "}
          {item.mediaType === "movie" ? "Movie" : "TV Show"}
          {item.voteAverage ? ` · ${item.voteAverage.toFixed(1)}` : ""}
        </span>
      </span>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background">
        <Plus className="size-4" />
      </span>
    </>
  );
  const className =
    "flex min-h-24 items-center gap-4 border-b border-border py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return itemId ? (
    <Link to="/item/$itemId" params={{ itemId }} className={className}>
      {content}
    </Link>
  ) : (
    <Link
      to="/title/$mediaType/$tmdbId"
      params={{ mediaType: item.mediaType, tmdbId: String(item.id) }}
      search={{ preview: JSON.stringify({
        id: item.id,
        mediaType: item.mediaType,
        title: item.title,
        posterPath: item.posterPath,
        overview: item.overview,
        releaseDate: item.releaseDate,
      }) }}
      className={className}
    >
      {content}
    </Link>
  );
}

function PersonRow({
  person,
  pending,
  onFollow,
}: {
  person: Person;
  pending: boolean;
  onFollow: () => void;
}) {
  const label =
    person.relationship === "accepted"
      ? "Following"
      : person.relationship === "pending"
        ? "Requested"
        : person.isPublic
          ? "Follow"
          : "Request";
  return (
    <div className="flex min-h-20 items-center gap-3 border-b border-border py-3">
      <Link
        to="/u/$username"
        params={{ username: person.username }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-card text-sm font-bold">
          {person.avatarUrl ? (
            <img src={person.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <UserRound className="size-5" />
          )}
        </div>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm">@{person.username}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">
            {person.followerCount.toLocaleString()} follower
            {person.followerCount === 1 ? "" : "s"} ·{" "}
            {person.isPublic ? "Public" : "Private"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      {person.relationship !== "self" && (
        <Button
          size="sm"
          variant={person.relationship === "none" ? "default" : "outline"}
          disabled={pending}
          onClick={onFollow}
        >
          {pending ? "Saving…" : label}
        </Button>
      )}
    </div>
  );
}

function TagRow({ tag }: { tag: PublicTag }) {
  return (
    <Link
      to="/tag/$tag"
      params={{ tag: tag.tag }}
      className="flex min-h-20 items-center gap-3 border-b border-border py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex h-16 w-24 shrink-0 items-center pl-2">
        {tag.posters.length ? (
          tag.posters.slice(0, 3).map((poster, index) => (
            <div
              key={`${poster.title}:${poster.posterPath ?? ""}`}
              className="aspect-[2/3] w-10 overflow-hidden rounded-md border-2 border-background bg-card"
              style={{ marginLeft: index ? -12 : 0 }}
            >
              {poster.posterPath && (
                <img
                  src={posterUrl(poster.posterPath)}
                  alt=""
                  className="size-full object-cover"
                />
              )}
            </div>
          ))
        ) : (
          <div className="grid size-12 place-items-center rounded-full bg-card">
            <Tags className="size-5 text-muted-foreground" />
          </div>
        )}
      </div>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm">{tag.tag}</strong>
        <span className="mt-1 block text-xs text-muted-foreground">
          {tag.titleCount} {tag.titleCount === 1 ? "title" : "titles"} ·{" "}
          {tag.contributorCount} {tag.contributorCount === 1 ? "person" : "people"}
        </span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

export function ExplorePage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [media, setMedia] = useState<MediaResult[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingPeople, setPendingPeople] = useState<Set<string>>(() => new Set());
  const searchMedia = useAction(api.tmdb.searchMulti);
  const follow = useMutation(api.profiles.follow);
  const unfollow = useMutation(api.profiles.unfollow);
  const library = useQuery(api.library.listItems, {});
  const people = useQuery(
    api.profiles.search,
    debounced.length >= 2 && (filter === "all" || filter === "people")
      ? { query: debounced }
      : "skip",
  ) as Person[] | undefined;
  const publicTags = useQuery(
    api.tags.searchPublic,
    debounced.length >= 2 && (filter === "all" || filter === "tags")
      ? { query: debounced }
      : "skip",
  ) as PublicTag[] | undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const needsMedia = debounced.length >= 2 && filter !== "people" && filter !== "tags";

  useEffect(() => {
    if (!needsMedia) {
      setMedia([]);
      setMediaLoading(false);
      return undefined;
    }
    let ignore = false;
    setMediaLoading(true);
    setError("");
    void searchMedia({ query: debounced })
      .then((results) => {
        if (!ignore) setMedia(results);
        return undefined;
      })
      .catch(() => {
        if (!ignore) {
          setMedia([]);
          setError("Search is unavailable right now.");
        }
        return undefined;
      })
      .finally(() => {
        if (!ignore) setMediaLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [debounced, needsMedia, searchMedia]);

  const existingByMedia = useMemo(
    () =>
      new Map(
        (library ?? []).map((item) => [
          `${item.mediaType}:${item.tmdbId}`,
          String(item._id),
        ]),
      ),
    [library],
  );
  const movies = media.filter((item) => item.mediaType === "movie");
  const shows = media.filter((item) => item.mediaType === "tv");
  const ready = debounced.length >= 2;
  const visibleMedia = filter === "movie" ? movies : filter === "tv" ? shows : media;
  const visiblePeople = filter === "all" || filter === "people" ? people ?? [] : [];
  const visibleTags = filter === "all" || filter === "tags" ? publicTags ?? [] : [];
  const loading =
    ready &&
    (filter === "people"
      ? people === undefined
      : filter === "tags"
        ? publicTags === undefined
        : filter === "all"
          ? mediaLoading || people === undefined || publicTags === undefined
          : mediaLoading);
  const hasResults = visibleMedia.length || visiblePeople.length || visibleTags.length;

  const updateFollow = async (person: Person) => {
    if (person.relationship === "self" || pendingPeople.has(person.username)) return;
    setPendingPeople((current) => new Set(current).add(person.username));
    try {
      if (person.relationship === "none") await follow({ username: person.username });
      else await unfollow({ username: person.username });
    } catch {
      setError("Couldn’t update that follow right now.");
    } finally {
      setPendingPeople((current) => {
        const next = new Set(current);
        next.delete(person.username);
        return next;
      });
    }
  };

  const mediaRow = (item: MediaResult) => (
    <MediaRow
      key={`${item.mediaType}:${item.id}`}
      item={item}
      itemId={existingByMedia.get(`${item.mediaType}:${item.id}`)}
    />
  );
  const personRow = (person: Person) => (
    <PersonRow
      key={person.username}
      person={person}
      pending={pendingPeople.has(person.username)}
      onFollow={() => void updateFollow(person)}
    />
  );

  return (
    <Page width="compact">
      <PageHeader title="Explore" />
      <div className="mt-6">
        <SearchField
          size="prominent"
          aria-label="Search movies, TV shows, people, and tags"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Movies, TV shows, people, or tags"
          maxLength={200}
        />
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList className="mt-[18px] grid h-[46px] w-full grid-cols-5 rounded-none border-x-0 border-t-0 bg-transparent p-0">
            <TabsTrigger className="h-[46px] rounded-none border-b-2 border-transparent bg-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground" value="all">All</TabsTrigger>
            <TabsTrigger className="h-[46px] rounded-none border-b-2 border-transparent bg-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground" value="movie">Movies</TabsTrigger>
            <TabsTrigger className="h-[46px] rounded-none border-b-2 border-transparent bg-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground" value="tv">TV shows</TabsTrigger>
            <TabsTrigger className="h-[46px] rounded-none border-b-2 border-transparent bg-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground" value="people">People</TabsTrigger>
            <TabsTrigger className="h-[46px] rounded-none border-b-2 border-transparent bg-transparent px-1 text-xs data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground" value="tags">Tags</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-8" aria-live="polite">
        {error && hasResults ? (
          <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>
        ) : null}
        {!ready ? (
          <div className="py-20 text-center">
            <p className="text-sm font-semibold">Search all of Marker</p>
            <p className="mt-2 text-xs text-muted-foreground">Find movies, TV shows, people, or public tags.</p>
          </div>
        ) : loading ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="h-24 animate-pulse rounded-xl bg-card" />
            ))}
          </div>
        ) : error && !hasResults ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : !hasResults ? (
          <div className="py-20 text-center">
            <p className="text-sm font-semibold">No results</p>
            <p className="mt-2 text-xs text-muted-foreground">Try a different search.</p>
          </div>
        ) : filter === "all" ? (
          <div className="grid gap-10">
            {movies.length > 0 && (
              <section>
                <SectionHeader title="Movies" />
                {movies.slice(0, 3).map(mediaRow)}
              </section>
            )}
            {shows.length > 0 && (
              <section>
                <SectionHeader title="TV shows" />
                {shows.slice(0, 3).map(mediaRow)}
              </section>
            )}
            {visiblePeople.length > 0 && (
              <section>
                <SectionHeader title="People" />
                {visiblePeople.slice(0, 3).map(personRow)}
              </section>
            )}
            {visibleTags.length > 0 && (
              <section>
                <SectionHeader title="Tags" />
                {visibleTags.slice(0, 3).map((tag) => (
                  <TagRow key={tag.tag.toLocaleLowerCase()} tag={tag} />
                ))}
              </section>
            )}
          </div>
        ) : filter === "people" ? (
          visiblePeople.map(personRow)
        ) : filter === "tags" ? (
          visibleTags.map((tag) => (
            <TagRow key={tag.tag.toLocaleLowerCase()} tag={tag} />
          ))
        ) : (
          visibleMedia.map(mediaRow)
        )}
      </div>
    </Page>
  );
}
