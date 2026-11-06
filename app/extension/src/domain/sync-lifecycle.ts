export type AccountLifecycle =
  | { state: "available"; revision: number }
  | { state: "signingOut"; revision: number; pending: number };
export function transitionAccount(
  current: AccountLifecycle,
  event: "changed" | "signOut" | "signedOut",
): AccountLifecycle {
  const revision = current.revision + 1;
  switch (event) {
    case "changed":
      return { ...current, revision };
    case "signOut":
      return {
        state: "signingOut",
        revision,
        pending: current.state === "signingOut" ? current.pending + 1 : 1,
      };
    case "signedOut":
      return current.state === "signingOut" && current.pending > 1
        ? { state: "signingOut", revision, pending: current.pending - 1 }
        : { state: "available", revision };
  }
}

export type HydrationState = "pending" | "live";
export const transitionHydration = (
  _current: HydrationState,
  _event: "storageChanged",
): HydrationState => "live";

export type DeliveryState<A> =
  { state: "idle" } | { state: "flushing"; effect: A };

export type RetryEvent = "delivered" | "failed" | "enqueued";
export type OutboxLifecycle =
  | { state: "empty" }
  | { state: "queued" }
  | { state: "backoff"; until: number; attempt: number }
  | { state: "due"; attempt: number };
export function outboxLifecycle(
  count: number,
  retry: { attempt: number; nextRetryAt: number } | null,
  now: number,
): OutboxLifecycle {
  if (count === 0) return { state: "empty" };
  if (!retry) return { state: "queued" };
  return retry.nextRetryAt > now
    ? { state: "backoff", until: retry.nextRetryAt, attempt: retry.attempt }
    : { state: "due", attempt: retry.attempt };
}

export type RetryLifecycle =
  | { state: "unscheduled" }
  | { state: "waiting"; until: number }
  | { state: "due" };
export function retryLifecycle(
  retry: { nextRetryAt: number } | null,
  now: number,
): RetryLifecycle {
  if (!retry) return { state: "unscheduled" };
  return retry.nextRetryAt > now
    ? { state: "waiting", until: retry.nextRetryAt }
    : { state: "due" };
}
