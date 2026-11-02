import { describe, expect, it, vi } from 'vitest';
import {
  parseStartupSnapshot,
  snapshotMatches,
  StartupSnapshotStore,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_MAX_BYTES,
  type SnapshotScope,
  type StartupData,
} from '../../src/lib/startupSnapshot';

const scope: SnapshotScope = { userId: 'user_a', sessionId: 'session_a', environment: 'dev' };
const data = {
  profile: { username: 'first', isPublic: false, followerCount: 0, followingCount: 0 },
  items: [],
  settings: {},
  stats: { favorites: [] },
  tags: [],
  requests: [],
} as unknown as StartupData;
const envelope = () => ({ version: 1, scope, data, savedAt: Date.now() });

describe('startup snapshots', () => {
  it('requires the exact user, session, environment and an unexpired timestamp', () => {
    const snapshot = parseStartupSnapshot(JSON.stringify(envelope()));
    expect(snapshotMatches(snapshot, scope)).toBe(true);
    for (const key of ['userId', 'sessionId', 'environment'] as const) {
      expect(snapshotMatches(snapshot, { ...scope, [key]: 'different' })).toBe(false);
    }
    expect(snapshotMatches(snapshot, undefined)).toBe(false);
    expect(snapshotMatches(snapshot, scope, snapshot!.savedAt + SNAPSHOT_MAX_AGE_MS)).toBe(false);
    expect(snapshotMatches(snapshot, scope, snapshot!.savedAt - 1)).toBe(false);
  });

  it('rejects truncated, incompatible and incomplete snapshots', () => {
    for (const text of [
      '{',
      'null',
      '[]',
      JSON.stringify({ ...envelope(), version: 0 }),
      JSON.stringify({ ...envelope(), data: { ...data, items: undefined } }),
      JSON.stringify({ ...envelope(), data: { ...data, profile: null } }),
    ]) {
      expect(parseStartupSnapshot(text)).toBeNull();
    }
  });

  it('applies the disk byte limit to multibyte snapshots when saving and parsing', async () => {
    const large = {
      ...data,
      profile: { ...data.profile, username: '語'.repeat(Math.ceil(SNAPSHOT_MAX_BYTES / 3)) },
    };
    const text = JSON.stringify({ ...envelope(), data: large });
    expect(text.length).toBeLessThan(SNAPSHOT_MAX_BYTES);
    expect(parseStartupSnapshot(text)).toBeNull();
    const storage = {
      read: async () => null,
      write: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    await new StartupSnapshotStore(storage).save(scope, large);
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledOnce();
  });

  it('cannot resurrect a snapshot when its disk read finishes after sign-out', async () => {
    let finish!: (text: string) => void;
    const storage = {
      read: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
      write: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const store = new StartupSnapshotStore(storage);
    const read = store.read();
    await store.clear();
    finish(JSON.stringify(envelope()));
    expect(await read).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it('removes an in-flight disk write before finishing sign-out', async () => {
    let finish!: () => void;
    let disk: string | null = null;
    const store = new StartupSnapshotStore({
      read: async () => disk,
      write: (text) =>
        new Promise<void>((resolve) => {
          finish = () => {
            disk = text;
            resolve();
          };
        }),
      remove: async () => {
        disk = null;
      },
    });
    const save = store.save(scope, data);
    await Promise.resolve();
    const clear = store.clear();
    finish();
    await Promise.all([save, clear]);
    expect(disk).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it('retains the latest acknowledged data and cancels obsolete queued writes', async () => {
    let disk: string | null = null;
    const write = vi.fn(async (text: string) => {
      disk = text;
    });
    const store = new StartupSnapshotStore({
      read: async () => disk,
      write,
      remove: async () => {
        disk = null;
      },
    });
    await store.read();
    const first = store.save(scope, data);
    const updated = { ...data, profile: { ...data.profile, username: 'updated' } };
    const second = store.save(scope, updated);
    await Promise.all([first, second]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(parseStartupSnapshot(disk!)?.data.profile.username).toBe('updated');
    expect((await store.read())?.data).toEqual(updated);
  });

  it('falls back to normal loading when storage is unavailable', async () => {
    const fail = async () => {
      throw new Error('disk unavailable');
    };
    const store = new StartupSnapshotStore({ read: fail, write: fail, remove: fail });
    expect(await store.read()).toBeNull();
    await expect(store.save(scope, data)).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
