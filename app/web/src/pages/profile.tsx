import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChartNoAxesColumn,
  Globe2,
  Library,
  LockKeyhole,
  Pencil,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { ProfileFavorites } from "@/components/profile-favorites";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { posterUrl } from "@/lib/utils";

export function ProfilePage() {
  const profile = useQuery(api.profiles.me, {});
  const stats = useQuery(api.stats.profile, {});
  const publicTags = useQuery(api.tags.myPublic, {});
  const requests = useQuery(api.profiles.followRequests, {});
  const respond = useMutation(api.profiles.respondToFollow);
  const [requestPending, setRequestPending] = useState<string>();
  const [requestError, setRequestError] = useState("");
  const [tab, setTab] = useState<"collection" | "stats">("collection");
  const identity = profile;
  const metrics = stats;
  const cards = [
    {
      label: "Watch time",
      value: metrics
        ? `${Math.floor(metrics.totalWatchMinutes / 1440)}d ${Math.floor((metrics.totalWatchMinutes % 1440) / 60)}h`
        : "—",
      detail: metrics ? `${metrics.totalWatchMinutes.toLocaleString()} minutes` : undefined,
    },
    { label: "Episodes", value: metrics?.episodesWatched.toLocaleString() ?? "—", detail: undefined },
    { label: "Movies Watched", value: metrics?.moviesWatched.toLocaleString() ?? "—", detail: undefined },
    { label: "Shows Watched", value: metrics?.showsWatched.toLocaleString() ?? "—", detail: undefined },
    { label: "Library Items", value: metrics?.totalItems.toLocaleString() ?? "—", detail: undefined },
    { label: "Average Rating", value: metrics?.avgRating ? metrics.avgRating.toFixed(1) : "—", detail: undefined },
  ];

  const handleRequest = async (username: string, accept: boolean) => {
    setRequestPending(username);
    setRequestError("");
    try {
      await respond({ username, accept });
    } catch {
      setRequestError("Couldn’t update that follow request.");
    } finally {
      setRequestPending(undefined);
    }
  };

  return (
    <Page width="wide" className="max-w-4xl">
      <PageHeader title="Profile" />
      {!identity || !metrics ? (
        <div className="mt-6 h-72 animate-pulse rounded-xl bg-card" />
      ) : (
        <>
          <section className="mt-6 flex flex-col gap-5 pb-7 sm:flex-row sm:items-center">
            <div className="grid size-[104px] shrink-0 place-items-center overflow-hidden rounded-full bg-card text-2xl font-bold">
              {identity.avatarUrl ? (
                <img src={identity.avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                identity.username?.[0]?.toUpperCase() ?? "M"
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-bold tracking-[-.03em]">
                @{identity.username ?? "profile"}
              </h2>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                {identity.isPublic ? <Globe2 className="size-3.5" /> : <LockKeyhole className="size-3.5" />}
                {identity.isPublic ? "Public profile" : "Private profile"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {identity.followerCount.toLocaleString()} followers ·{" "}
                {identity.followingCount.toLocaleString()} following
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link to="/profile/edit">
                <Pencil className="size-4" /> Edit
              </Link>
            </Button>
          </section>

          <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
            <TabsList className="mt-5 grid h-[52px] w-full grid-cols-2 rounded-none border-x-0 border-t-0 bg-transparent p-0">
              <TabsTrigger value="collection" className="h-[52px] gap-2 rounded-none border-b-2 border-transparent bg-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground">
                <Library className="size-4" /> Collection
              </TabsTrigger>
              <TabsTrigger value="stats" className="h-[52px] gap-2 rounded-none border-b-2 border-transparent bg-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground">
                <ChartNoAxesColumn className="size-4" /> Stats
              </TabsTrigger>
            </TabsList>

          {requests?.length ? (
            <section className="mt-9 border-b border-border pb-8">
              <SectionHeader title="Follow requests" />
              <div className="mt-2 divide-y divide-border">
                {requests.map((request) => (
                  <div key={request.username} className="flex min-h-16 items-center gap-3 py-3">
                    <Link
                      to="/u/$username"
                      params={{ username: request.username }}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-card text-xs font-bold">
                        {request.avatarUrl ? (
                          <img src={request.avatarUrl} alt="" className="size-full object-cover" />
                        ) : (
                          request.username[0]?.toUpperCase()
                        )}
                      </div>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">@{request.username}</strong>
                        <span className="text-xs text-muted-foreground">
                          {request.followerCount.toLocaleString()} follower{request.followerCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </Link>
                    <Button
                      variant="ghost"
                      aria-label={`Decline @${request.username}`}
                      disabled={requestPending === request.username}
                      onClick={() => void handleRequest(request.username, false)}
                    >
                      Decline
                    </Button>
                    <Button
                      aria-label={`Accept @${request.username}`}
                      disabled={requestPending === request.username}
                      onClick={() => void handleRequest(request.username, true)}
                    >
                      Accept
                    </Button>
                  </div>
                ))}
              </div>
              {requestError && <p role="alert" className="mt-3 text-xs text-destructive">{requestError}</p>}
            </section>
          ) : null}

          {tab === "collection" ? (
            <TabsContent value="collection" className="mt-10 grid gap-12">
              <ProfileFavorites favorites={metrics.favorites} />
              <section>
                <SectionHeader title="Top tags" />
                <div className="mt-4 flex flex-wrap gap-2">
                  {metrics.topTags.length ? metrics.topTags.map((tag) => (
                    <Link
                      key={tag.tag}
                      to="/tags/$tag"
                      params={{ tag: tag.tag }}
                      className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {tag.tag} · {tag.count}
                    </Link>
                  )) : <span className="text-sm text-muted-foreground">No tags yet.</span>}
                </div>
              </section>
              {identity.username && publicTags?.length ? (
                <section>
                  <SectionHeader title="Public tags" />
                  <div className="mt-[18px] grid grid-cols-2 gap-x-[4%] gap-y-[30px]">
                    {publicTags.map((tag) => (
                      <Link
                        key={tag.tag}
                        to="/u/$username/tags/$tag"
                        params={{ username: identity.username!, tag: tag.tag }}
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
                                <img src={posterUrl(poster.posterPath)} alt="" className="size-full object-cover" />
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
              ) : null}
            </TabsContent>
          ) : (
            <TabsContent value="stats" className="mt-8 grid grid-cols-2 gap-x-[4%] gap-y-1">
              {cards.map(({ label, value, detail }) => (
                <div key={label} className="min-h-[110px] border-b border-border py-[18px]">
                  <strong className="block text-[25px] font-bold tabular-nums">{value}</strong>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {label}
                  </span>
                  {detail && <span className="mt-1 block text-[11px] text-muted-foreground">{detail}</span>}
                </div>
              ))}
            </TabsContent>
          )}
          </Tabs>
        </>
      )}
    </Page>
  );
}
