# Marker

Marker tracks movies, series, and watched episodes across a web app, an Expo mobile app, and a browser extension for Crunchyroll and Netflix.

## Repository

| Directory | Responsibility |
| --- | --- |
| `app/web` | React/Vite web client |
| `app/mobile/src` | Expo/React Native client |
| `app/mobile/convex` | Shared Convex backend, schema, authentication, and provider integrations |
| `app/extension` | WXT browser extension and local playback bookmarks |
| `scripts` | Production dependency audit tools |

The web app imports the shared backend's generated API types from `app/mobile/convex/_generated`. There is one backend for both clients. TMDB supplies search and base title metadata; TVDB supplies matched anime season ordering and episode identities. Provider calls stay in the backend.

The [architecture review](docs/architecture-review.md) explains the data model, refactor decisions, and remaining scaling boundaries.

## Development

Use Node.js 24, matching CI. Each app has its own package manifest and lockfile; run commands from the relevant app directory.

```sh
npm ci --prefix app/mobile
npm ci --prefix app/web
npm ci --prefix app/extension
```

Copy the relevant app's `.env.example` to a local environment file and configure its values. Web and mobile must point to the same intended Convex deployment. Configure backend provider credentials and Clerk authentication on that deployment.

```sh
# Run from app/mobile for the shared backend
npx convex dev

# Run clients in separate terminals
npm run dev --prefix app/web
npm run start --prefix app/mobile
```

For the extension, run `npm run build --prefix app/extension`, open `chrome://extensions`, enable Developer mode, and load `app/extension/.output/chrome-mv3`. The extension stores bookmarks locally; connected tracking uses the shared backend.

## Verification

```sh
npm run check --prefix app/mobile
npm run check --prefix app/web
npm run check --prefix app/extension
```

Web builds require the `VITE_CONVEX_URL` and `VITE_CLERK_PUBLISHABLE_KEY` settings from the web environment example. CI also exports the iOS and Android bundles and audits production dependencies; see [the workflow](.github/workflows/check.yml).

Commit regenerated Convex API types alongside backend changes. A pull request does not deploy a backend schema change; deploy the reviewed backend before relying on newly added response fields in clients.
