import type { ReactNode } from "react";
import { Navigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { safeInternalPath } from "@/lib/utils";
import { useMarkerAccount } from "@/hooks/use-marker-account";
import { AccountLinkError, AccountLoading } from "@/components/account-states";

export function AuthGate({
  children,
  setup = false,
}: {
  children: ReactNode;
  setup?: boolean;
}) {
  const { isAuthenticated, isLoading, accountReady, accountError, retryAccountLink } =
    useMarkerAccount();
  const profile = useQuery(
    api.profiles.me,
    !isAuthenticated || !accountReady ? "skip" : {},
  );
  const location = useRouterState({
    select: (state) => state.resolvedLocation ?? state.location,
  });

  if (accountError) return <AccountLinkError onRetry={retryAccountLink} />;
  if (
    isLoading ||
    (isAuthenticated && (!accountReady || profile === undefined))
  ) {
    return <AccountLoading />;
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
