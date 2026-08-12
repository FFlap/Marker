import { Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { safeInternalPath } from "@/lib/utils";
import { LoginPage } from "@/pages/login";
import { useMarkerAccount } from "@/hooks/use-marker-account";

export function LoginGate() {
  const { isAuthenticated, isLoading, accountReady, accountError, retryAccountLink } =
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


  if (accountError) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center text-sm text-destructive">
        <div>We couldn’t link this account to Marker.<button type="button" className="mt-3 block w-full underline" onClick={retryAccountLink}>Try again</button></div>
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
