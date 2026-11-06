import { accountAccess } from "@marker/shared/lifecycle";
import { Navigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@marker/shared/api";
import { safeInternalPath } from "@/lib/utils";
import { LoginPage } from "@/pages/login";
import { useMarkerAccount } from "@/hooks/use-marker-account";
import { AccountLinkError, AccountLoading } from "@/components/account-states";

export function LoginGate() {
  const {
    isAuthenticated,
    isLoading,
    accountReady,
    accountError,
    retryAccountLink,
  } = useMarkerAccount();
  const profile = useQuery(
    api.profiles.me,
    isAuthenticated && accountReady ? {} : "skip",
  );
  const search = useSearch({ from: "/login" });
  const next = safeInternalPath(search.next);

  const access = accountAccess({
    isLoading,
    isAuthenticated,
    accountReady,
    accountError,
    profileLoaded: profile !== undefined,
    hasUsername: !!profile?.username,
  });
  if (access.state === "error")
    return <AccountLinkError onRetry={retryAccountLink} />;
  if (access.state === "loading") {
    return <AccountLoading />;
  }
  if (access.state === "setupRequired") {
    return <Navigate to="/setup" search={{ next }} replace />;
  }
  if (access.state === "ready") return <Navigate to={next} replace />;
  return <LoginPage />;
}
