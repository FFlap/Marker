import { getClerkUserId } from './clerkAuth';
import { query } from './_generated/server';
import { v } from 'convex/values';

const MAX_FOLLOWS = 50;
const MAX_EVENTS_PER_ACTOR = 40;
const MAX_ACTIVITY = 100;

export const feed = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      actorUsername: v.string(),
      avatarUrl: v.optional(v.string()),
      kind: v.union(
        v.literal('rating'),
        v.literal('status'),
        v.literal('finished'),
        v.literal('episode'),
      ),
      title: v.string(),
      posterPath: v.optional(v.string()),
      rating: v.optional(v.number()),
      status: v.optional(
        v.union(
          v.literal('watched'),
          v.literal('watching'),
          v.literal('watchlist'),
          v.literal('dropped'),
        ),
      ),
      season: v.optional(v.number()),
      episode: v.optional(v.number()),
      occurredAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const viewerId = await getClerkUserId(ctx);
    if (!viewerId) throw new Error('Authentication required');
    const settings = await ctx.db
      .query('settings')
      .withIndex('by_user', (query) => query.eq('userId', viewerId))
      .unique();
    const showRatings = settings?.activityRatings ?? true;
    const showStatuses = settings?.activityWatching ?? true;
    const showWatched = settings?.activityWatched ?? true;
    const follows = await ctx.db
      .query('follows')
      .withIndex('by_follower_status', (query) =>
        query.eq('followerId', viewerId).eq('status', 'accepted'),
      )
      .order('desc')
      .take(MAX_FOLLOWS);

    const groups = await Promise.all(
      follows.map(async (follow) => {
        const actor = await ctx.db.get(follow.followingId);
        if (!actor?.username) return [];
        const actorUsername = actor.username;
        const [events, avatarUrl] = await Promise.all([
          ctx.db
            .query('activityEvents')
            .withIndex('by_actor_time', (query) => query.eq('userId', actor._id))
            .order('desc')
            .take(MAX_EVENTS_PER_ACTOR),
          actor.avatarStorageId ? ctx.storage.getUrl(actor.avatarStorageId) : Promise.resolve(null),
        ]);
        return events.flatMap((event) => {
          const enabled =
            (event.kind === 'rating' && showRatings) ||
            (event.kind === 'status' && showStatuses) ||
            ((event.kind === 'finished' || event.kind === 'episode') && showWatched);
          if (!enabled) return [];
          return [
            {
              id: String(event._id),
              actorUsername,
              ...(avatarUrl && { avatarUrl }),
              kind: event.kind,
              title: event.title,
              ...(event.posterPath !== undefined && { posterPath: event.posterPath }),
              ...(event.rating !== undefined && { rating: event.rating }),
              ...(event.status !== undefined && { status: event.status }),
              ...(event.season !== undefined && { season: event.season }),
              ...(event.episode !== undefined && { episode: event.episode }),
              occurredAt: event.createdAt,
            },
          ];
        });
      }),
    );
    return groups
      .flat()
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, MAX_ACTIVITY);
  },
});
