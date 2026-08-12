import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { LoginGate } from "@/components/login-gate";
import { EpisodesPage } from "@/pages/episodes";
import { ExplorePage } from "@/pages/explore";
import { ExtensionConnectPage } from "@/pages/extension-connect";
import { LibraryPage } from "@/pages/library";
import { ProfilePage } from "@/pages/profile";
import { ProfileSetupPage } from "@/pages/profile-setup";
import { SettingsPage } from "@/pages/settings";
import { TagsPage } from "@/pages/tags";
import { NotificationsPage } from "@/pages/notifications";
import { CalendarPage } from "@/pages/calendar";
import { ItemDetailPage } from "@/pages/item-detail";
import { TagDetailPage } from "@/pages/tag-detail";
import { TitleDetailPage } from "@/pages/title-detail";
import { PublicTagPage } from "@/pages/public-tag";
import { PublicProfilePage } from "@/pages/public-profile";
import { PublicUserTagPage } from "@/pages/public-user-tag";
import { ProfileEditPage } from "@/pages/profile-edit";
import { TagAddPage } from "@/pages/tag-add";

const rootRoute = createRootRoute({ component: Outlet });
const protectedLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: () => (
    <AuthGate>
      <AppShell />
    </AuthGate>
  ),
});
const routes = [
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/",
    component: LibraryPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/episodes",
    component: EpisodesPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/tags",
    component: TagsPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/explore",
    component: ExplorePage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/notifications",
    component: NotificationsPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/calendar",
    component: CalendarPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/profile",
    component: ProfilePage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/profile/edit",
    component: ProfileEditPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/settings",
    component: SettingsPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/item/$itemId",
    component: ItemDetailPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/tags/$tag",
    component: TagDetailPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/tags/$tag/add",
    component: TagAddPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/tag/$tag",
    component: PublicTagPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/u/$username",
    component: PublicProfilePage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/u/$username/tags/$tag",
    component: PublicUserTagPage,
  }),
  createRoute({
    getParentRoute: () => protectedLayout,
    path: "/title/$mediaType/$tmdbId",
    validateSearch: (search: Record<string, unknown>) => ({
      preview: typeof search.preview === "string" ? search.preview : undefined,
    }),
    component: TitleDetailPage,
  }),
];
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: LoginGate,
});
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: () => (
    <AuthGate setup>
      <ProfileSetupPage />
    </AuthGate>
  ),
});
const extensionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/extension/connect",
  component: () => (
    <AuthGate>
      <ExtensionConnectPage />
    </AuthGate>
  ),
});
const routeTree = rootRoute.addChildren([
  protectedLayout.addChildren(routes),
  loginRoute,
  setupRoute,
  extensionRoute,
]);
export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
