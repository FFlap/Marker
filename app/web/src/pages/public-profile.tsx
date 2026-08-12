import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ChartNoAxesColumn, Library } from "lucide-react";
import { LockKeyhole } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { ProfileFavorites } from "@/components/profile-favorites";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { posterUrl } from "@/lib/utils";

type Stats = {
  totalWatchMinutes: number;
  episodesWatched: number;
  moviesWatched: number;
  showsWatched: number;
  totalItems: number;
  avgRating: number;
  favorites: Array<{
    _id: string;
    title: string;
    mediaType: "movie" | "tv";
    isAnime: boolean;
    posterPath?: string;
    rank: number;
  }>;
  topTags: Array<{ tag: string; count: number }>;
};

export function PublicProfilePage() {
  const { username } = useParams({ from: "/app/u/$username" });
  const result = useQuery(api.profiles.publicProfile, { username });
  const follow = useMutation(api.profiles.follow);
  const unfollow = useMutation(api.profiles.unfollow);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"collection" | "stats">("collection");
  if (result === undefined) {
    return (
      <Page width="wide" className="max-w-4xl">
        <PageHeader title="Profile" back backFallback="/explore" />
        <div className="mt-6 h-72 animate-pulse rounded-xl bg-card" />
      </Page>
    );
  }
  if (result === null) {
    return (
      <Page width="wide" className="max-w-4xl">
        <PageHeader title="Profile" back backFallback="/explore" />
        <p className="mt-20 text-center text-sm text-muted-foreground">
          Profile not found.
        </p>
      </Page>
    );
  }
  const stats = "stats" in result ? (result.stats as Stats) : undefined;
  const relationship = result.relationship;
  const followLabel =
    relationship === "accepted"
      ? "Following"
      : relationship === "pending"
        ? "Requested"
        : result.profile.isPublic
          ? "Follow"
          : "Request to follow";
  const updateFollow = async () => {
    if (!relationship || relationship === "self" || pending) return;
    setPending(true);
    setError("");
    try {
      if (relationship === "none")
        await follow({ username: result.profile.username });
      else await unfollow({ username: result.profile.username });
    } catch {
      setError("Couldn’t update this follow right now.");
    } finally {
      setPending(false);
    }
  };
  const cards = stats
    ? [
        {
          label: "Watch time",
          value: `${Math.floor(stats.totalWatchMinutes / 1440)}d ${Math.floor((stats.totalWatchMinutes % 1440) / 60)}h`,
          detail: `${stats.totalWatchMinutes.toLocaleString()} minutes`,
        },
        {
          label: "Episodes",
          value: stats.episodesWatched.toLocaleString(),
          detail: undefined,
        },
        {
          label: "Movies Watched",
          value: stats.moviesWatched.toLocaleString(),
          detail: undefined,
        },
        {
          label: "Shows Watched",
          value: stats.showsWatched.toLocaleString(),
          detail: undefined,
        },
        {
          label: "Library Items",
          value: stats.totalItems.toLocaleString(),
          detail: undefined,
        },
        {
          label: "Average Rating",
          value: stats.avgRating ? stats.avgRating.toFixed(1) : "—",
          detail: undefined,
        },
      ]
    : [];

  return (
    <Page width="wide" className="max-w-4xl">
      <PageHeader
        title={`@${result.profile.username}`}
        back
        backFallback="/explore"
      />
      <section className="mt-6 flex flex-col gap-5 pb-7 sm:flex-row sm:items-center">
        <div className="grid size-[104px] shrink-0 place-items-center overflow-hidden rounded-full bg-card text-2xl font-bold">
          {result.profile.avatarUrl ? (
            <img
              src={result.profile.avatarUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            result.profile.username[0]?.toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-bold tracking-[-.03em]">
            @{result.profile.username}
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {result.profile.followerCount.toLocaleString()} followers ·{" "}
            {result.profile.followingCount.toLocaleString()} following
          </p>
        </div>
        {relationship && relationship !== "self" && (
          <Button
            variant={relationship === "none" ? "default" : "outline"}
            disabled={pending}
            onClick={() => void updateFollow()}
          >
            {pending ? "Saving…" : followLabel}
          </Button>
        )}
      </section>
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="mt-5 grid h-[52px] w-full grid-cols-2 rounded-none border-x-0 border-t-0 bg-transparent p-0">
          <TabsTrigger
            value="collection"
            className="h-[52px] gap-2 rounded-none border-b-2 border-transparent bg-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
          >
            <Library className="size-4" /> Collection
          </TabsTrigger>
          <TabsTrigger
            value="stats"
            className="h-[52px] gap-2 rounded-none border-b-2 border-transparent bg-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
          >
            <ChartNoAxesColumn className="size-4" /> Stats
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {stats ? (
        tab === "collection" ? (
          <div className="mt-10 grid gap-12">
            <ProfileFavorites favorites={stats.favorites} interactive={false} />
            <section>
              <SectionHeader title="Top tags" />
              <div className="mt-4 flex flex-wrap gap-2">
                {stats.topTags.length ? (
                  stats.topTags.map((tag) => (
                    <span
                      key={tag.tag}
                      className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground"
                    >
                      {tag.tag} · {tag.count}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No tags yet.
                  </span>
                )}
              </div>
            </section>
            <PublicTags
              username={result.profile.username}
              tags={result.publicTags}
            />
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-[4%] gap-y-1">
            {cards.map(({ label, value, detail }) => (
              <div
                key={label}
                className="min-h-[110px] border-b border-border py-[18px]"
              >
                <strong className="block text-[25px] font-bold tabular-nums">
                  {value}
                </strong>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {label}
                </span>
                {detail && (
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === "collection" && result.publicTags.length ? (
        <div className="mt-10">
          <p className="mb-8 text-xs text-muted-foreground">
            Other profile activity is private.
          </p>
          <PublicTags
            username={result.profile.username}
            tags={result.publicTags}
          />
        </div>
      ) : (
        <div className="mt-20 text-center">
          <LockKeyhole className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-4 text-sm font-semibold">
            {tab === "stats" ? "Stats are private" : "This profile is private"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {tab === "stats"
              ? "Follow this person to request access to their activity."
              : relationship === "pending"
                ? "Your follow request is waiting for approval."
                : "Follow this person to request access to their activity."}
          </p>
        </div>
      )}
    </Page>
  );
}

function PublicTags({
  username,
  tags,
}: {
  username: string;
  tags: Array<{
    tag: string;
    count: number;
    posters: Array<{ title: string; posterPath?: string }>;
  }>;
}) {
  if (!tags.length) return null;
  return (
    <section>
      <SectionHeader title="Public tags" />
      <div className="mt-[18px] grid grid-cols-2 gap-x-[4%] gap-y-[30px]">
        {tags.map((tag) => (
          <Link
            key={tag.tag}
            to="/u/$username/tags/$tag"
            params={{ username, tag: tag.tag }}
            className="min-w-0 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-[198px] w-full items-end justify-center overflow-hidden rounded-2xl bg-card">
              <div className="flex h-[198px] w-full max-w-[220px] items-end justify-center">
                {tag.posters.slice(0, 3).map((poster, index) => (
                  <div
                    key={`${poster.title}:${poster.posterPath ?? "none"}`}
                    className={`aspect-[2/3] w-[60%] max-w-[132px] overflow-hidden rounded-xl border-2 border-background bg-card shadow-xl ${index ? "-ml-[40%]" : ""}`}
                  >
                    {poster.posterPath && (
                      <img
                        src={posterUrl(poster.posterPath)}
                        alt=""
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
            <strong className="mt-1 block truncate text-base">{tag.tag}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}
