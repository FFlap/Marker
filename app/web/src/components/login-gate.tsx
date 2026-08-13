import { Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { safeInternalPath } from "@/lib/utils";
import { LoginPage } from "@/pages/login";
import { useMarkerAccount } from "@/hooks/use-marker-account";
import { AccountLinkError, AccountLoading } from "@/components/account-states";

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


  if (accountError) return <AccountLinkError onRetry={retryAccountLink} />;
  if (
    isLoading ||
    (isAuthenticated && (!accountReady || profile === undefined))
  ) {
    return <AccountLoading />;
  }
  if (isAuthenticated && !profile?.username) {
    return <Navigate to="/setup" search={{ next }} replace />;
  }
  if (isAuthenticated) return <Navigate to={next} replace />;
  return <LoginPage />;
}
