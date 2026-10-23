import { runClientEffect } from "@marker/shared/clientOperations";
import { Effect } from "effect";
import { linkAccount } from "@marker/shared/clientEffects";
import { useCallback, useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@marker/shared/api";

export function useMarkerAccount() {
  const auth = useConvexAuth();
  const ensureCurrentUser = useMutation(api.clerkAuth.ensureCurrentUser);
  const [state, setState] = useState<"idle" | "linking" | "ready" | "error">(
    "idle",
  );
  const [attempt, setAttempt] = useState(0);
  const retryAccountLink = useCallback(
    () => setAttempt((value) => value + 1),
    [],
  );

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setState("idle");
      return undefined;
    }
    setState("linking");
    const controller = new AbortController();
    void runClientEffect(
      linkAccount(() => ensureCurrentUser({})).pipe(
        Effect.match({
          onSuccess: () => setState("ready"),
          onFailure: () => setState("error"),
        }),
      ),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [attempt, auth.isAuthenticated, ensureCurrentUser]);

  return {
    ...auth,
    accountReady: !auth.isAuthenticated || state === "ready",
    accountError: state === "error",
    retryAccountLink,
  };
}
