# Web architecture review and refactor

Reviewed against `main` at `7fcc8b3`. This PR changes only the web client. The companion `mobile/refactor` PR owns the shared Convex schema and provider pipeline.

## Findings addressed

| Severity | Finding and effect | Change |
| --- | --- | --- |
| Important | Explore accepted longer searches than the backend allowed. Dialog and Explore duplicated request/error handling and could display stale results. | Share a bounded search hook with request cancellation guards and explicit retry. Keep submitted searches separate from input drafts. |
| Important | Item detail subscribed to the entire library even though rendering already depended on the dedicated item view. | Use the authoritative item view and the existing tag-suggestion endpoint. |
| Important | An exhausted empty cache was presented as an empty season while a provider refresh was still queued or running. Rejected item refreshes were swallowed. | Share a season-guide hook that distinguishes loading, empty, and failure; surface a retry action. |
| Important | Episode pages were concatenated without guarding against provider/order changes or restarted cursors. | Deduplicate chunk indexes, reject mismatched versions, and expose only a contiguous prefix. |
| Important | The title route could retain the previous title's local state; separate detail pages repeated selection and hand-written API response types. | Reset route state on identity changes, centralize season selection, and derive catalog types from the generated API. |
| Important | One pending episode key was shared by overlapping watched mutations. Completion of one write could re-enable another still-pending control. | Track pending writes independently per episode. |
| Suggestion | Library, tag, and public collection filters repeated logic and disagreed with backend case-insensitive tag identity. | Use common predicates and keep filter types independent of the filter-dialog component. |

## Boundaries

The web app consumes `app/mobile/convex/_generated/api`. TMDB/TVDB requests, metadata caching, provider identity, totals, and schema ownership remain on that shared backend. The frontend owns presentation, selected season, submitted searches, and transient mutation state.

The new hooks retain the existing endpoint contract. They also accept optional `seasonVersion` and `episodeCountVerified` fields supplied by the companion backend PR. Unknown totals remain selectable, without displaying a false zero. Neither PR requires the other to be merged first, although full version-aware pagination and count-recovery behavior requires the backend changes to be deployed.

The library API's existing 2,000-item limit remains a scaling boundary. Moving the backend to a workspace package and introducing server pagination should be separate changes with their own deployment and client migration plans.

## Validation

Behavioral tests cover search races and bounds, season navigation, queued refreshes, rejected refresh retry, unknown totals, mixed pagination versions, case-insensitive filters, and overlapping watched mutations. The PR records the complete lint, typecheck, test, and production-build results.
