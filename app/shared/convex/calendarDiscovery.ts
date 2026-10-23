import { Effect, Schema } from 'effect';
import { actionFailureCause, attempt, runActionEffect } from './actionEffects';
import { ConvexError, v } from 'convex/values';
import { internalAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { createRequestEffect } from './calendarProviders';
import { providerBoundaryFailure } from './providerHttp';
import { CALENDAR_TTL_MS, catalogRegion, monthEnd } from './calendarTypes';

const discoveryPage = Schema.Struct({
  total_pages: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  results: Schema.Array(
    Schema.Struct({
      id: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    }),
  ).check(Schema.isMaxLength(1000)),
});

export const continueDiscovery = internalAction({
  args: { month: v.string(), region: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const progress = await ctx.runQuery(internal.calendarRefresh.progress, args);
    if (!progress) return null;
    await runActionEffect(
      Effect.gen(function* () {
        const start = `${args.month}-01`;
        const end = monthEnd(args.month);
        const path =
          args.region === 'tv'
            ? `/discover/tv?include_adult=true&include_null_first_air_dates=true&timezone=UTC&air_date.gte=${start}&air_date.lte=${end}`
            : progress.feed === 0
              ? `/discover/movie?include_adult=true&include_video=true&region=${args.region.slice(6)}&release_date.gte=${start}&release_date.lte=${end}`
              : `/discover/movie?include_adult=true&include_video=true&primary_release_date.gte=${start}&primary_release_date.lte=${end}`;
        const payload = yield* createRequestEffect(
          ctx,
          1,
        )(`${path}&page=${progress.page}`).pipe(
          Effect.flatMap((payload) =>
            Schema.decodeUnknownEffect(discoveryPage)(payload).pipe(
              Effect.mapError(() => new Error('Invalid release discovery response')),
            ),
          ),
        );
        if (payload.total_pages > 500)
          return yield* Effect.fail(new Error('Release discovery needs a narrower date range'));
        const candidates = payload.results.map((entry) => ({
          mediaType: args.region === 'tv' ? ('tv' as const) : ('movie' as const),
          tmdbId: entry.id,
        }));
        yield* attempt(() =>
          ctx.runMutation(internal.calendarRefresh.checkpoint, {
            ...args,
            ...progress,
            totalPages: payload.total_pages as number,
            candidates,
          }),
        );
      }).pipe(
        Effect.catch((error) => {
          const cause = providerBoundaryFailure(actionFailureCause(error));
          const message =
            cause instanceof Error && cause.message.trim()
              ? cause.message
              : 'Release discovery failed';
          const permanent =
            /Invalid release|narrower date range|not configured|request failed \(4/.test(message);
          return attempt(() =>
            ctx.runMutation(internal.calendarRefresh.failed, {
              ...args,
              ...progress,
              permanent,
              message,
            }),
          );
        }),
      ),
    );
    return null;
  },
});

export async function ensureMonth(
  ctx: ActionCtx,
  month: string,
  region: string,
  mediaType: 'tv' | 'movie',
) {
  const args = { month, region: catalogRegion(region, mediaType) };
  const current = await ctx.runQuery(internal.calendarCatalog.metadata, args);
  if (current && current.refreshedAt > Date.now() - CALENDAR_TTL_MS) return;
  const token = crypto.randomUUID();
  if (current?.error && (current.retryAt ?? 0) > Date.now()) {
    if (current.version) return;
    throw new Error(current.error);
  }
  await ctx.runMutation(internal.calendarCatalog.claim, { ...args, token });
  const saved = await ctx.runQuery(internal.calendarCatalog.metadata, args);
  if (!saved || saved.refreshedAt <= Date.now() - CALENDAR_TTL_MS)
    throw new ConvexError({ code: 'calendar_refresh_pending', retryable: true });
}
