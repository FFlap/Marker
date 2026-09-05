import { getClerkUserId } from './clerkAuth';
import { query } from './_generated/server';
import { profileStatsForUser } from './profileStats';
import { statsValidator } from './publicValidators';
export const profile = query({
  args: {},
  returns: statsValidator,
  handler: async (ctx) => {
    const userId = await getClerkUserId(ctx);
    if (!userId) throw new Error('Authentication required');
    return profileStatsForUser(ctx, userId);
  },
});
