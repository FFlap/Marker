import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.hourly(
  'Prune metadata refresh leases',
  { minuteUTC: 17 },
  internal.resolvedMetadata.pruneRefreshLeases,
);

crons.hourly('Prune provider snapshots', { minuteUTC: 16 }, internal.providerSnapshots.prune, {});

crons.hourly('Prune avatar uploads', { minuteUTC: 13 }, internal.profiles.pruneAvatarUploads, {});

crons.hourly(
  'Prune metadata refresh requests',
  { minuteUTC: 15 },
  internal.resolvedMetadata.pruneRefreshRequests,
  {},
);

crons.hourly(
  'Prune expired request throttles',
  { minuteUTC: 14 },
  internal.resolvedMetadata.pruneRequestThrottle,
  {},
);

export default crons;
