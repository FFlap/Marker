import { useAuth } from "@clerk/react";
import type { ReactNode } from "react";
import { Navigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { safeInternalPath } from "@/lib/utils";
import { useMarkerAccount } from "@/hooks/use-marker-account";
import { AccountLinkError, AccountLoading } from "@/components/account-states";

export function AuthGate(props: { children: ReactNode; setup?: boolean }) {
  const { userId } = useAuth();
  return <AccountGate key={userId} {...props} />;
}

function AccountGate({
  children,
  setup = false,
}: {
  children: ReactNode;
  setup?: boolean;
}) {
  const {
    isAuthenticated,
    isLoading,
    accountReady,
    accountError,
    retryAccountLink,
  } = useMarkerAccount();
  const profile = useQuery(
    api.profiles.me,
    !isAuthenticated || !accountReady ? "skip" : {},
  );
  const search = useSearch({ strict: false });
  const location = useRouterState({ select: (state) => state.location });

  if (accountError) return <AccountLinkError onRetry={retryAccountLink} />;
  if (
    isLoading ||
    (isAuthenticated && (!accountReady || profile === undefined))
  ) {
    return <AccountLoading />;
  }

  const next = `${location.pathname}${location.searchStr}`;
  if (!isAuthenticated)
    return location.pathname === "/login" ? (
      <AccountLoading />
    ) : (
      <Navigate to="/login" search={{ next }} replace />
    );
  if (!profile?.username && !setup)
    return location.pathname === "/setup" ? (
      <AccountLoading />
    ) : (
      <Navigate to="/setup" search={{ next }} replace />
    );
  if (profile?.username && setup) {
    if (location.pathname !== "/setup") return <AccountLoading />;
    const searchNext = (search as { next?: unknown }).next;
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
