import type { UserIdentity } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  internalQuery,
  mutation,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { normalizeUsername, validateUsername } from './profileRules';

type AuthOnlyCtx = { auth: { getUserIdentity(): Promise<UserIdentity | null> } };
type ReadCtx = AuthOnlyCtx & { db: QueryCtx['db'] };
type ActionLikeCtx = AuthOnlyCtx & Pick<ActionCtx, 'runQuery'>;

const normalizeEmail = (email: string | undefined) => email?.trim().toLocaleLowerCase();

async function findUserId(ctx: Pick<QueryCtx, 'db'>, subject: string): Promise<Id<'users'> | null> {
  const byClerk = await ctx.db
    .query('users')
    .withIndex('by_clerk_id', (q) => q.eq('clerkId', subject))
    .unique();
  return byClerk?._id ?? null;
}

export const userIdForIdentity = internalQuery({
  args: { subject: v.string() },
  handler: (ctx, args) => findUserId(ctx, args.subject),
});

/** Resolves the current Clerk subject to its Marker user document. */
export async function getClerkUserId(ctx: AuthOnlyCtx): Promise<Id<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const readCtx = ctx as Partial<ReadCtx>;
  if (readCtx.db) return findUserId(readCtx as ReadCtx, identity.subject);
  const actionCtx = ctx as ActionLikeCtx;
  return (await actionCtx.runQuery(internal.clerkAuth.userIdForIdentity, {
    subject: identity.subject,
  })) as Id<'users'> | null;
}

function usernameCandidate(identity: UserIdentity, requestedUsername?: string) {
  const claimed = requestedUsername ?? identity.preferredUsername ?? identity.nickname;
  if (claimed) {
    try {
      return validateUsername(claimed).username;
    } catch {
      // Fall through to a deterministic, valid username.
    }
  }
  const emailPrefix = normalizeEmail(identity.email)
    ?.split('@')[0]
    ?.replace(/[^A-Za-z0-9_]/g, '');
  const stem = emailPrefix && emailPrefix.length >= 3 ? emailPrefix.slice(0, 16) : 'marker';
  const suffix = identity.subject.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'user';
  const candidate = `${stem}_${suffix}`.slice(0, 24);
  try {
    return validateUsername(candidate).username;
  } catch {
    return validateUsername(`marker_${suffix}`.slice(0, 24)).username;
  }
}

async function availableUsername(
  ctx: MutationCtx,
  identity: UserIdentity,
  requestedUsername?: string,
) {
  const base = usernameCandidate(identity, requestedUsername);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 21)}_${attempt}`;
    const normalized = normalizeUsername(candidate);
    const existing = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('normalizedUsername', normalized))
      .unique();
    if (!existing) return { username: candidate, normalizedUsername: normalized };
  }
  throw new Error('Could not reserve a username for this account');
}

/** Ensures each Clerk identity is linked to exactly one existing Marker profile. */
export const ensureCurrentUser = mutation({
  args: { username: v.optional(v.string()) },
  returns: v.id('users'),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Unauthenticated');

    const alreadyLinked = await ctx.db
      .query('users')
      .withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.subject))
      .unique();
    if (alreadyLinked) return alreadyLinked._id;

    const email = normalizeEmail(identity.email);
    if (email) {
      const duplicateEmail = await ctx.db
        .query('users')
        .withIndex('email', (q) => q.eq('email', email))
        .first();
      if (duplicateEmail)
        throw new Error('This email is already attached to another Marker profile');
    }

    const now = Date.now();
    const username = await availableUsername(ctx, identity, args.username);
    return ctx.db.insert('users', {
      clerkId: identity.subject,
      ...(email && { email }),
      ...username,
      ...(identity.name && { name: identity.name }),
      ...(identity.pictureUrl && { image: identity.pictureUrl }),
      isPublic: false,
      profileCreatedAt: now,
      profileUpdatedAt: now,
      followerCount: 0,
      followingCount: 0,
    });
  },
});
