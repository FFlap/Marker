import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useNavigate, useRouter, type RegisteredRouter } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function Page({
  children,
  className,
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  width?: "compact" | "wide" | "full";
}) {
  return (
    <div
      className={cn(
        "mx-auto min-h-[100dvh] w-full px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8 sm:px-8 lg:px-12 lg:pb-28 lg:pt-12",
        width === "compact" && "max-w-3xl",
        width === "wide" && "max-w-6xl",
        width === "full" && "max-w-[1440px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function BackButton({
  fallback = "/explore",
  label = "Go back",
}: {
  fallback?: keyof RegisteredRouter["routesByPath"] & string;
  label?: string;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-11 shrink-0 place-items-center rounded-full bg-transparent text-foreground transition hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-10"
      onClick={() => {
        if (router.history.canGoBack()) {
          router.history.back();
          return;
        }
        void navigate({ to: fallback });
      }}
    >
      <ChevronLeft className="size-5" strokeWidth={2.25} />
    </button>
  );
}

export function PageHeader({
  title,
  actions,
  back,
  backFallback,
  className,
}: {
  title: string;
  actions?: ReactNode;
  back?: boolean;
  backFallback?: keyof RegisteredRouter["routesByPath"] & string;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-10 items-center justify-between gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {back && <BackButton fallback={backFallback} />}
        <h1 className="truncate text-[26px] font-bold leading-none tracking-[-.6px]">
          {title}
        </h1>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 items-center justify-between gap-3 border-b border-border pb-2",
        className,
      )}
    >
      <h2 className="min-w-0 truncate text-[13px] font-semibold tracking-[.2px] text-muted-foreground">
        {title}
      </h2>
      {(count !== undefined || action) && (
        <div className="flex shrink-0 items-center gap-3">
          {count !== undefined && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {String(count).padStart(2, "0")}
            </span>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
