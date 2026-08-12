import type { ReactNode } from "react";
import { Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { isDemoMode, safeInternalPath } from "@/lib/utils";
import { useMarkerAccount } from "@/hooks/use-marker-account";

export function AuthGate({
  children,
  setup = false,
}: {
  children: ReactNode;
  setup?: boolean;
}) {
  const demo = isDemoMode();
  const { isAuthenticated, isLoading, accountReady, accountError } =
    useMarkerAccount();
  const profile = useQuery(
    api.profiles.me,
    demo || !isAuthenticated || !accountReady ? "skip" : {},
  );
  const location = useRouterState({ select: (state) => state.location });

  if (demo) return children;
  if (accountError) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center text-sm text-destructive">
        We couldn’t link this Clerk account to Marker. Please sign out and try
        again.
      </div>
    );
  }
  if (
    isLoading ||
    (isAuthenticated && (!accountReady || profile === undefined))
  ) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Opening Marker…
      </div>
    );
  }

  const next = `${location.pathname}${location.searchStr}`;
  if (!isAuthenticated)
    return <Navigate to="/login" search={{ next }} replace />;
  if (!profile?.username && !setup)
    return <Navigate to="/setup" search={{ next }} replace />;
  if (profile?.username && setup) {
    const searchNext = (location.search as { next?: unknown }).next;
    return (
      <Navigate
        to={safeInternalPath(
          typeof searchNext === "string" ? searchNext : undefined,
        )}
        replace
      />
    );
  }
  return children;
}
