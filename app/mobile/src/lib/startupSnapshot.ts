import type { FunctionReturnType } from 'convex/server';
import type { api } from '@marker/shared/api';

export type StartupData = {
  profile: FunctionReturnType<typeof api.profiles.me>;
  items: FunctionReturnType<typeof api.library.items.listItems>;
  settings: FunctionReturnType<typeof api.settings.getSettings>;
  stats: FunctionReturnType<typeof api.stats.profile>;
  tags: FunctionReturnType<typeof api.tags.myPublic>;
  requests: FunctionReturnType<typeof api.profiles.followRequests>;
};

// A snapshot never grants authentication. Clerk must confirm this exact session before use.
export type SnapshotScope = { userId: string; sessionId: string; environment: string };
export type StartupSnapshot = {
  version: 1;
  scope: SnapshotScope;
  savedAt: number;
  data: StartupData;
};
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseStartupSnapshot(text: string): StartupSnapshot | null {
  try {
    if (text.length > SNAPSHOT_MAX_BYTES) return null;
    const snapshot: unknown = JSON.parse(text);
    if (!record(snapshot) || snapshot.version !== 1 || !record(snapshot.scope)) return null;
    if (
      !['userId', 'sessionId', 'environment'].every(
        (key) =>
          typeof snapshot.scope === 'object' &&
          typeof (snapshot.scope as Record<string, unknown>)[key] === 'string' &&
          !!(snapshot.scope as Record<string, unknown>)[key],
      ) ||
      typeof snapshot.savedAt !== 'number' ||
      !Number.isFinite(snapshot.savedAt)
    )
      return null;
    const data = snapshot.data;
    if (
      !record(data) ||
      !record(data.profile) ||
      !record(data.settings) ||
      !record(data.stats) ||
      typeof data.profile.username !== 'string' ||
      typeof data.profile.isPublic !== 'boolean' ||
      typeof data.profile.followerCount !== 'number' ||
      typeof data.profile.followingCount !== 'number' ||
      !Array.isArray(data.items) ||
      !Array.isArray(data.stats.favorites) ||
      !Array.isArray(data.tags) ||
      !Array.isArray(data.requests)
    )
      return null;
    return snapshot as StartupSnapshot;
  } catch {
    return null;
  }
}

export function snapshotMatches(
  snapshot: StartupSnapshot | null,
  scope: SnapshotScope | undefined,
  now = Date.now(),
): snapshot is StartupSnapshot {
  return (
    !!snapshot &&
    !!scope &&
    snapshot.scope.userId === scope.userId &&
    snapshot.scope.sessionId === scope.sessionId &&
    snapshot.scope.environment === scope.environment &&
    snapshot.savedAt <= now &&
    now - snapshot.savedAt < SNAPSHOT_MAX_AGE_MS
  );
}

/** Serialize disk operations so a late read/write cannot resurrect data after sign-out. */
export class StartupSnapshotStore {
  private generation = 0;
  private pending: Promise<void> = Promise.resolve();
  private snapshot: StartupSnapshot | null = null;
  private loaded: Promise<StartupSnapshot | null> | undefined;
  constructor(
    private readonly storage: {
      read(): Promise<string | null>;
      write(text: string): Promise<void>;
      remove(): Promise<void>;
    },
  ) {}

  read() {
    if (!this.loaded) {
      const generation = this.generation;
      this.loaded = this.storage
        .read()
        .then((text) => {
          if (generation === this.generation)
            this.snapshot = text ? parseStartupSnapshot(text) : null;
          return this.snapshot;
        })
        .catch(() => null);
    }
    return this.loaded.then(() => this.snapshot);
  }

  save(scope: SnapshotScope, data: StartupData) {
    const generation = ++this.generation;
    const snapshot: StartupSnapshot = { version: 1, scope, data, savedAt: Date.now() };
    this.snapshot = snapshot;
    this.pending = this.pending
      .then(async () => {
        if (generation !== this.generation) return;
        const text = JSON.stringify(snapshot);
        if (text.length > SNAPSHOT_MAX_BYTES) {
          await this.storage.remove();
          return;
        }
        await this.storage.write(text);
      })
      .catch(() => undefined);
    return this.pending;
  }

  clear() {
    ++this.generation;
    this.snapshot = null;
    this.pending = this.pending.then(() => this.storage.remove()).catch(() => undefined);
    return this.pending;
  }
}
