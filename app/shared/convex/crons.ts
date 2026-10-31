import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.hourly(
  'Prune metadata refresh leases',
  { minuteUTC: 17 },
  internal.resolvedMetadata.orchestration.pruneRefreshLeases,
);

// Canonical payloads have a 30-day retention window; scanning them hourly rereads
// every cached episode chunk even when nothing can be deleted.
crons.daily(
  'Prune canonical metadata',
  { hourUTC: 4, minuteUTC: 40 },
  internal.resolvedMetadata.cleanup.pruneCanonicalData,
  {},
);

crons.hourly('Prune provider snapshots', { minuteUTC: 16 }, internal.providerSnapshots.prune, {});

crons.hourly('Prune avatar uploads', { minuteUTC: 13 }, internal.profiles.pruneAvatarUploads, {});

crons.hourly(
  'Prune metadata refresh requests',
  { minuteUTC: 15 },
  internal.resolvedMetadata.cleanup.pruneRefreshRequests,
  {},
);

crons.hourly(
  'Prune expired request throttles',
  { minuteUTC: 14 },
  internal.resolvedMetadata.cleanup.pruneRequestThrottle,
  {},
);

crons.daily(
  'Prune past calendar months',
  { hourUTC: 4, minuteUTC: 20 },
  internal.calendarCatalog.prune,
  {},
);

export default crons;
