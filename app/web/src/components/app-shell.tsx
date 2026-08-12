import { useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  Compass,
  Library,
  ListVideo,
  Menu,
  Settings,
  Tags,
  UserRound,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { isDemoMode } from "@/lib/utils";

const destinations = [
  { to: "/", label: "Library", icon: Library },
  { to: "/episodes", label: "Episodes", icon: ListVideo },
  { to: "/tags", label: "Tags", icon: Tags },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const mobileDestinations = destinations.slice(0, 3);

function Navigation({
  mobile = false,
  compact = false,
  collapsed = false,
  requestCount = 0,
}: {
  mobile?: boolean;
  compact?: boolean;
  collapsed?: boolean;
  requestCount?: number;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const visible = compact
    ? mobileDestinations
    : mobile
      ? destinations.slice(3)
      : destinations;
  return (
    <nav
      aria-label={compact ? "Mobile navigation" : "Main navigation"}
      className={
        compact ? "grid grid-cols-3" : mobile ? "grid gap-2" : "grid gap-1"
      }
    >
      {visible.map(({ to, label, icon: Icon }) => {
        const active = to === "/" ? path === "/" : path.startsWith(to);
        const link = (
          <Link
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={`group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${
              compact
                ? "flex-col justify-center gap-1 rounded-none py-2 text-[10px]"
                : ""
            } ${collapsed ? "mx-auto w-11 justify-center gap-0 px-0" : ""} ${
              active
                ? compact
                  ? "text-foreground"
                  : "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Icon className="size-[18px]" strokeWidth={1.8} />
            <span className={collapsed ? "sr-only" : undefined}>{label}</span>
            {to === "/notifications" && requestCount > 0 && (
              <span
                className={
                  collapsed
                    ? "absolute right-1 top-1 size-2 rounded-full bg-destructive"
                    : "ml-auto grid min-w-5 place-items-center rounded-full bg-destructive px-1.5 text-[10px] leading-5 text-white"
                }
                aria-label={`${requestCount} follower ${requestCount === 1 ? "request" : "requests"}`}
              >
                {!collapsed && Math.min(requestCount, 99)}
              </span>
            )}
            {compact && active && (
              <span className="absolute inset-x-5 bottom-0 h-0.5 rounded-full bg-foreground" />
            )}
          </Link>
        );
        return mobile ? (
          <DialogClose asChild key={to}>
            {link}
          </DialogClose>
        ) : (
          link
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const demo = isDemoMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const profile = useQuery(api.profiles.me, demo ? "skip" : {});
  const requests = useQuery(api.profiles.followRequests, demo ? "skip" : {});
  return (
    <div className="min-h-[100dvh]">
      <aside
        data-collapsed={sidebarCollapsed}
        className={`fixed inset-y-0 left-0 z-30 hidden overflow-hidden border-r border-border bg-background transition-[width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] lg:block ${sidebarCollapsed ? "w-16" : "w-64"}`}
      >
        <button
          type="button"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((current) => !current)}
          className={`absolute top-5 z-10 grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground transition-[left,right,background-color,color] duration-300 ease-[cubic-bezier(.22,1,.36,1)] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sidebarCollapsed ? "left-3.5" : "right-5"}`}
        >
          <ChevronLeft
            className={`size-4 transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${sidebarCollapsed ? "rotate-180" : ""}`}
          />
        </button>
        <div
          className={`flex h-full flex-col py-5 ${sidebarCollapsed ? "w-16 px-2.5" : "w-64 px-5"}`}
        >
          <Brand
            className={`mb-9 px-2 transition-opacity duration-150 ${sidebarCollapsed ? "pointer-events-none opacity-0" : ""}`}
          />
          <Navigation
            collapsed={sidebarCollapsed}
            requestCount={requests?.length ?? 0}
          />
          <div
            className={`mt-auto transition-colors duration-200 ${sidebarCollapsed ? "mx-auto w-11 border-transparent bg-transparent p-0" : "rounded-xl border border-border bg-card p-3"}`}
          >
            <Link
              to="/profile"
              title={sidebarCollapsed ? "View Profile" : undefined}
              className={`flex min-h-11 items-center rounded-lg transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sidebarCollapsed ? "w-11 justify-center" : "gap-3 p-1"}`}
            >
              <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-xs font-bold text-background">
                {profile?.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  (demo ? "D" : (profile?.username?.[0] ?? "M")).toUpperCase()
                )}
              </div>
              <div className={sidebarCollapsed ? "sr-only" : "min-w-0"}>
                <p className="truncate text-xs font-semibold">
                  @{demo ? "demo_viewer" : (profile?.username ?? "profile")}
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground">
                  View Profile
                </p>
              </div>
            </Link>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex min-h-[calc(4rem+env(safe-area-inset-top))] items-center justify-between border-b border-border/75 bg-background/88 pb-0 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
        <Brand />
        <div>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="icon" variant="outline" className="size-11 sm:size-9">
                <Menu className="size-4" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:left-auto sm:right-4 sm:top-4 sm:translate-x-0 sm:translate-y-0">
              <DialogTitle>Navigate Marker</DialogTitle>
              <Navigation mobile requestCount={requests?.length ?? 0} />
              <DialogClose asChild>
                <Link
                  to="/profile"
                  className="flex min-h-11 items-center gap-3 rounded-xl border-t border-border px-3 pt-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
                >
                  <UserRound className="size-[18px]" strokeWidth={1.8} />
                  View Profile
                </Link>
              </DialogClose>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main
        data-sidebar-collapsed={sidebarCollapsed}
        className={`transition-[margin] duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`}
      >
        <Outlet />
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-xl lg:hidden">
        <Navigation compact />
      </div>
    </div>
  );
}
