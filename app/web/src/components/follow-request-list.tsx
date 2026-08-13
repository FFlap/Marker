import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { SectionHeader } from "@/components/page";
import { Button } from "@/components/ui/button";

export function FollowRequestList({ compact = false }: { compact?: boolean }) {
  const requests = useQuery(api.profiles.followRequests, {});
  const respond = useMutation(api.profiles.respondToFollow);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");

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

  if (requests === undefined)
    return <div className="mt-6 h-20 animate-pulse rounded-xl bg-card" />;
  if (!requests.length) return null;

  return (
    <section className={`${compact ? "mt-6" : "mt-9"} border-b border-border pb-8`}>
      <SectionHeader title="Follow requests" />
      <div className="mt-2 divide-y divide-border">
        {requests.map((request) => (
          <div
            key={request.username}
            className="flex min-h-16 items-center gap-3 py-3"
          >
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
                  {request.followerCount.toLocaleString()} follower
                  {request.followerCount === 1 ? "" : "s"}
                </span>
              </span>
            </Link>
            {compact ? (
              <>
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
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  aria-label={`Decline @${request.username}`}
                  disabled={pending === request.username}
                  onClick={() => void handleRequest(request.username, false)}
                >
                  Decline
                </Button>
                <Button
                  aria-label={`Accept @${request.username}`}
                  disabled={pending === request.username}
                  onClick={() => void handleRequest(request.username, true)}
                >
                  Accept
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
