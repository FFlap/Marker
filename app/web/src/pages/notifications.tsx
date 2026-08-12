import { useState } from "react";
import { Bell, Check, Clock3, Eye, Star, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { isDemoMode, posterUrl } from "@/lib/utils";

type Activity = {
  id: string;
  actorUsername: string;
  avatarUrl?: string;
  kind: "rating" | "status" | "finished" | "episode";
  title: string;
  posterPath?: string;
  rating?: number;
  status?: "watched" | "watching" | "watchlist" | "dropped";
  season?: number;
  episode?: number;
  occurredAt: number;
};

const demoActivity: Activity[] = [
  {
    id: "a",
    actorUsername: "mika",
    kind: "rating",
    title: "Perfect Days",
    rating: 9.4,
    occurredAt: Date.now() - 42 * 60_000,
    posterPath: "/mjEk5Wwx6TYVqw29zSaUHclMIgp.jpg",
  },
  {
    id: "b",
    actorUsername: "noah",
    kind: "status",
    status: "watching",
    title: "Severance",
    occurredAt: Date.now() - 4 * 3_600_000,
    posterPath: "/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg",
  },
  {
    id: "c",
    actorUsername: "mika",
    kind: "episode",
    title: "Frieren: Beyond Journey’s End",
    season: 1,
    episode: 18,
    occurredAt: Date.now() - 28 * 3_600_000,
    posterPath: "/dqZENchTd7lp5zht7BdlqM7RBhD.jpg",
  },
];

function relativeTime(value: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function activityText(activity: Activity) {
  if (activity.kind === "rating")
    return (
      <>
        {activity.rating === undefined
          ? `removed their rating for ${activity.title}`
          : `rated ${activity.title} ${activity.rating.toFixed(1)}/10`}
      </>
    );
  if (activity.kind === "status")
    return (
      <>
        {activity.status === "watching"
          ? `started watching ${activity.title}`
          : `moved ${activity.title} to ${activity.status ?? "another list"}`}
      </>
    );
  if (activity.kind === "finished") return <>finished {activity.title}</>;
  return (
    <>
      watched {activity.title} · S{activity.season} E{activity.episode}
    </>
  );
}

export function NotificationsPage() {
  const demo = isDemoMode();
  const requests = useQuery(api.profiles.followRequests, demo ? "skip" : {});
  const queriedActivity = useQuery(api.notifications.feed, demo ? "skip" : {});
  const respond = useMutation(api.profiles.respondToFollow);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const activity = demo ? demoActivity : queriedActivity;
  const handleRequest = async (username: string, accept: boolean) => {
    setPending(username);
    setError("");
    try {
      await respond({ username, accept });
    } catch {
      setError("Couldn’t update that follow request.");
    } finally {
      setPending(undefined);
    }
  };
  return (
    <Page width="compact">
      <PageHeader title="Notifications" />
      {!demo && requests === undefined ? (
        <div className="mt-6 h-20 animate-pulse rounded-xl bg-card" />
      ) : (
        Boolean(requests?.length) && (
          <section className="mt-6 border-b border-border pb-8">
            <SectionHeader title="Follow requests" />
            <div className="mt-2">
              {requests?.map((request) => (
                <div
                  key={request.username}
                  className="flex min-h-16 items-center gap-3 py-3"
                >
                  <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-xs font-bold text-background">
                    {request.avatarUrl ? (
                      <img
                        src={request.avatarUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      request.username[0]?.toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      @{request.username}
                    </strong>
                    <span className="text-[10px] text-muted-foreground">
                      {request.followerCount} follower
                      {request.followerCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <Button
                    aria-label={`Decline @${request.username}`}
                    variant="ghost"
                    size="icon"
                    disabled={pending === request.username}
                    onClick={() => void handleRequest(request.username, false)}
                  >
                    <X className="size-4" />
                  </Button>
                  <Button
                    aria-label={`Accept @${request.username}`}
                    size="icon"
                    disabled={pending === request.username}
                    onClick={() => void handleRequest(request.username, true)}
                  >
                    <Check className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {error}
              </p>
            )}
          </section>
        )
      )}
      <section className="mt-8">
        <SectionHeader
          title="FOLLOWING ACTIVITY"
          action={
            <span className="text-[10px] text-muted-foreground">
              Manage in Settings
            </span>
          }
        />
        {queriedActivity === undefined && !demo ? (
          <div className="mt-4 grid gap-2">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-20 animate-pulse rounded-xl bg-card"
              />
            ))}
          </div>
        ) : activity?.length ? (
          <div className="mt-4 divide-y divide-border">
            {activity.map((entry) => (
              <article
                key={entry.id}
                className="grid min-h-[76px] grid-cols-[40px_1fr_auto] items-center gap-3 py-3"
              >
                <div className="grid size-10 place-items-center overflow-hidden rounded-full bg-card text-xs font-bold">
                  {entry.avatarUrl ? (
                    <img
                      src={entry.avatarUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    entry.actorUsername[0]?.toUpperCase()
                  )}
                </div>
                <p className="min-w-0 text-xs leading-[18px]">
                  <strong>@{entry.actorUsername}</strong> {activityText(entry)}
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {relativeTime(entry.occurredAt)}
                  </span>
                </p>
                {entry.posterPath ? (
                  <div className="h-[50px] w-[34px] overflow-hidden rounded-md bg-card">
                    <img
                      src={posterUrl(entry.posterPath)}
                      alt={`${entry.title} poster`}
                      className="size-full object-cover"
                    />
                  </div>
                ) : (
                  <span className="grid size-[34px] place-items-center rounded-full bg-card text-muted-foreground">
                    {entry.kind === "rating" ? (
                      <Star className="size-4" />
                    ) : entry.kind === "status" ? (
                      <Eye className="size-4" />
                    ) : (
                      <Clock3 className="size-4" />
                    )}
                  </span>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-12 rounded-xl border border-dashed border-border p-10 text-center">
            <Bell className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-4 text-sm font-semibold">Nothing new yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Activity from people you follow will appear here.
            </p>
          </div>
        )}
      </section>
    </Page>
  );
}
