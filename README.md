# Marker

Marker tracks movies, series, and watched episodes across a web app, an Expo mobile app, and a browser extension for Crunchyroll and Netflix.

## Repository

| Directory | Responsibility |
| --- | --- |
| `app/web` | React/Vite web client |
| `app/mobile/src` | Expo/React Native client |
| `shared` | Convex backend, reusable calendar and watch-activity helpers, and their tests |
| `app/extension` | WXT browser extension and local playback bookmarks |

Web and mobile depend on the local `@marker/shared` package. They import the generated API from `@marker/shared/api`, document types from `@marker/shared/dataModel`, and pure helpers from `@marker/shared/calendar`, `@marker/shared/calendarCache`, and `@marker/shared/watchActivityStats`. Schema, server functions, authentication, HTTP handlers, and migrations live in `shared/convex`; portable helpers live in `shared/lib`. Backend tests and package tooling live alongside them in `shared`.

Apps may consume shared code only through its explicit package exports and must not import another app. Shared code must not depend on an app. Helpers in `shared/lib` may be used by both the backend and clients, so they must not import Convex functions, Node built-ins, or native dependencies.

All three apps use the same backend. The extension connects through the authenticated `/extension/watch` HTTP endpoint and does not need the Convex client SDK. TMDB supplies search and base title metadata; TVDB supplies matched anime season ordering and episode identities. Provider calls stay in the backend.

## Development

Use Node.js 24, matching CI. The shared package and each app have their own package manifest and lockfile. Install the shared package before the clients: npm links local `file:` dependencies but does not install their dependencies.

```sh
npm ci --prefix shared
npm ci --prefix app/mobile
npm ci --prefix app/web
npm ci --prefix app/extension
```

Copy `shared/.env.example` to `shared/.env.local` and set `CONVEX_DEPLOYMENT` to the intended existing deployment. Copy the relevant app's `.env.example` to a local environment file and configure its public client values. Web, mobile, and the extension must point to that same deployment. Configure backend provider credentials and Clerk authentication on the deployment from `shared`.

For an existing checkout, move the `CONVEX_DEPLOYMENT` setting from `app/mobile/.env.local` to `shared/.env.local`; keep the `EXPO_PUBLIC_*` settings in mobile. Backend commands now run from `shared`. Moving the source directory does not create a new database or require a data migration.

```sh
# Run the shared backend from the repository root
npm run dev --prefix shared

# Run clients in separate terminals
npm run dev --prefix app/web
npm run start --prefix app/mobile
```

For the extension, run `npm run build --prefix app/extension`, open `chrome://extensions`, enable Developer mode, and load `app/extension/.output/chrome-mv3`. The extension stores bookmarks locally; connected tracking uses the shared backend.

Vercel uses `app/web` as its project root and the checked-in install command installs the shared package first. Enable access to source files outside the project root so `shared` is available.

## Verification

```sh
npm run check --prefix shared
npm run check --prefix app/mobile
npm run check --prefix app/web
npm run check --prefix app/extension
```

Web builds require the `VITE_CONVEX_URL` and `VITE_CLERK_PUBLISHABLE_KEY` settings from the web environment example. CI also exports the iOS and Android bundles and audits production dependencies for the shared and web packages; see [the workflow](.github/workflows/check.yml).

Commit regenerated Convex API types alongside backend changes (`npm run codegen --prefix shared`). A pull request does not deploy a backend schema change; deploy the reviewed backend with `npm run deploy --prefix shared` before relying on newly added response fields in clients.
