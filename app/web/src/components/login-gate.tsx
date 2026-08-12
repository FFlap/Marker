import { Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { isDemoMode, safeInternalPath } from "@/lib/utils";
import { LoginPage } from "@/pages/login";
import { useMarkerAccount } from "@/hooks/use-marker-account";

export function LoginGate() {
  const demo = isDemoMode();
  const { isAuthenticated, isLoading, accountReady, accountError } =
    useMarkerAccount();
  const profile = useQuery(
    api.profiles.me,
    isAuthenticated && accountReady ? {} : "skip",
  );
  const search = useRouterState({
    select: (state) => state.location.search,
  }) as {
    next?: string;
  };
  const next = safeInternalPath(search.next);

  if (demo) return <LoginPage />;

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
  if (isAuthenticated && !profile?.username) {
    return <Navigate to="/setup" search={{ next }} replace />;
  }
  if (isAuthenticated) return <Navigate to={next} replace />;
  return <LoginPage />;
}
