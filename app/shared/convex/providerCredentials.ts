import { credentialState } from './lifecycles';
import { v } from 'convex/values';
import { internalQuery, internalMutation } from './_generated/server';

// Provider tokens are accessible only to backend functions, never public queries.
export const get = internalQuery({
  args: { keyHash: v.string() },
  returns: v.union(v.null(), v.object({ token: v.string(), expiresAt: v.number() })),
  handler: async (ctx, { keyHash }) => {
    const row = await ctx.db
      .query('providerCredentials')
      .withIndex('by_key', (q) => q.eq('keyHash', keyHash))
      .unique();
    const credential = credentialState(row, Date.now());
    return credential.state === 'usable'
      ? { token: credential.token, expiresAt: credential.expiresAt }
      : null;
  },
});

export const put = internalMutation({
  args: { keyHash: v.string(), token: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('providerCredentials')
      .withIndex('by_key', (q) => q.eq('keyHash', args.keyHash))
      .unique();
    if (row) await ctx.db.replace(row._id, args);
    else await ctx.db.insert('providerCredentials', args);
    return null;
  },
});

// A rejected token must not be read again, or delete a newer concurrent refresh.
export const invalidate = internalMutation({
  args: { keyHash: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (ctx, { keyHash, token }) => {
    const row = await ctx.db
      .query('providerCredentials')
      .withIndex('by_key', (q) => q.eq('keyHash', keyHash))
      .unique();
    if (row?.token === token) await ctx.db.delete(row._id);
    return null;
  },
});
