import { useCallback, useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";

export function useMarkerAccount() {
  const auth = useConvexAuth();
  const ensureCurrentUser = useMutation(api.clerkAuth.ensureCurrentUser);
  const [state, setState] = useState<"idle" | "linking" | "ready" | "error">(
    "idle",
  );
  const [attempt, setAttempt] = useState(0);
  const retryAccountLink = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    if (!auth.isAuthenticated) {
      setState("idle");
      return () => {
        active = false;
      };
    }
    setState("linking");
    void ensureCurrentUser({})
      .then(() => active && setState("ready"))
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [attempt, auth.isAuthenticated, ensureCurrentUser]);

  return {
    ...auth,
    accountReady: !auth.isAuthenticated || state === "ready",
    accountError: state === "error",
    retryAccountLink,
  };
}
