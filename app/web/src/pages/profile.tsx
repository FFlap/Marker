import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChartNoAxesColumn,
  Globe2,
  Library,
  LockKeyhole,
  Pencil,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@marker/shared/api";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { ProfileFavorites } from "@/components/profile-favorites";
import { ProfileStatsPanel } from "@/components/profile-stats";
import { FollowRequestList } from "@/components/follow-request-list";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PublicTags } from "@/pages/public-profile";

export function ProfilePage() {
  const profile = useQuery(api.profiles.me, {});
  const stats = useQuery(api.stats.profile, {});
  const publicTags = useQuery(api.tags.myPublic, {});
  const [tab, setTab] = useState<"collection" | "stats">("collection");

  return (
    <Page width="wide" className="max-w-4xl">
      <PageHeader title="Profile" />
      {!profile || !stats ? (
        <div className="mt-6 h-72 animate-pulse rounded-xl bg-card" />
      ) : (
        <>
          <section className="mt-6 flex flex-col gap-5 pb-7 sm:flex-row sm:items-center">
            <div className="grid size-[104px] shrink-0 place-items-center overflow-hidden rounded-full bg-card text-2xl font-bold">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                profile.username?.[0]?.toUpperCase() ?? "M"
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-bold tracking-[-.03em]">
                @{profile.username ?? "profile"}
              </h2>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                {profile.isPublic ? <Globe2 className="size-3.5" /> : <LockKeyhole className="size-3.5" />}
                {profile.isPublic ? "Public profile" : "Private profile"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {profile.followerCount.toLocaleString()} followers ·{" "}
                {profile.followingCount.toLocaleString()} following
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

          <FollowRequestList />

          {tab === "collection" ? (
            <TabsContent value="collection" className="mt-10 grid gap-12">
              <ProfileFavorites favorites={stats.favorites} />
              <section>
                <SectionHeader title="Top tags" />
                <div className="mt-4 flex flex-wrap gap-2">
                  {stats.topTags.length ? stats.topTags.map((tag) => (
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
              {profile.username ? (
                <PublicTags username={profile.username} tags={publicTags ?? []} />
              ) : null}
            </TabsContent>
          ) : (
            <TabsContent value="stats" className="mt-8">
              <ProfileStatsPanel stats={stats} />
            </TabsContent>
          )}
          </Tabs>
        </>
      )}
    </Page>
  );
}
