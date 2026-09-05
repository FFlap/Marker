import { Bell, Clock3, Eye, Star } from "lucide-react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../mobile/convex/_generated/api";
import { FollowRequestList } from "@/components/follow-request-list";
import { Page, PageHeader, SectionHeader } from "@/components/page";
import { posterUrl } from "@/lib/utils";

type Activity = FunctionReturnType<typeof api.notifications.feed>[number];

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
  const episodeLabel = activity.season !== undefined && activity.episode !== undefined
    ? ` · S${activity.season} E${activity.episode}`
    : "";
  return (
    <>
      watched {activity.title}{episodeLabel}
    </>
  );
}

export function NotificationsPage() {
  const queriedActivity = useQuery(api.notifications.feed, {});
  const activity = queriedActivity;
  return (
    <Page width="compact">
      <PageHeader title="Notifications" />
      <FollowRequestList compact />
      <section className="mt-8">
        <SectionHeader
          title="FOLLOWING ACTIVITY"
          action={
            <span className="text-[10px] text-muted-foreground">
              Manage in Settings
            </span>
          }
        />
        {queriedActivity === undefined ? (
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
