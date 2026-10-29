import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockQuery = jest.fn();
const mockPrefetch = jest.fn().mockResolvedValue(true);
jest.mock('convex/react', () => ({
  useQuery: (query: string, args: unknown) => mockQuery(query, args),
}));
jest.mock('expo-image', () => ({
  Image: { prefetch: (...args: unknown[]) => mockPrefetch(...args) },
}));
jest.mock('@marker/shared/api', () => ({
  api: {
    profiles: { me: 'profile', followRequests: 'requests' },
    library: { items: { listItems: 'items' } },
    settings: { getSettings: 'settings' },
    stats: { profile: 'stats' },
    tags: { myPublic: 'tags' },
  },
}));
import { StartupQueries } from '../../src/components/StartupQueries';
import { useStartupData, useStartupQuery } from '../../src/hooks/useStartupQuery';
import { startupSnapshotStore } from '../../src/lib/startupSnapshotStorage';
import { api } from '@marker/shared/api';
import type { StartupSnapshot } from '../../src/lib/startupSnapshot';

const scope = { userId: 'user_a', sessionId: 'session_a', environment: 'dev' };
const saved = () =>
  ({
    version: 1,
    scope,
    savedAt: Date.now(),
    data: {
      profile: { username: 'saved', isPublic: false, followerCount: 0, followingCount: 0 },
      items: [{ title: 'Saved title' }],
      settings: { defaultView: 'list' },
      stats: { favorites: [] },
      tags: [],
      requests: [],
    },
  }) as unknown as StartupSnapshot;
function Probe() {
  const profile = useStartupQuery(api.profiles.me);
  const items = useStartupQuery(api.library.items.listItems);
  const startup = useStartupData();
  return (
    <Text>
      {profile?.username ?? 'loading'}:{items?.[0]?.title ?? 'empty'}:
      {startup?.fresh ? 'fresh' : 'waiting'}
    </Text>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReturnValue(undefined);
  jest.mocked(startupSnapshotStore.read).mockResolvedValue(null);
});

it.each([
  ['unconfirmed identity', undefined, false],
  ['signed-out or rejected auth', scope, false],
  ['another user', { ...scope, userId: 'user_b' }, true],
  ['another session', { ...scope, sessionId: 'session_b' }, true],
  ['another backend', { ...scope, environment: 'prod' }, true],
] as const)('does not expose a saved snapshot for %s', async (_label, identity, allowCache) => {
  jest.mocked(startupSnapshotStore.read).mockResolvedValue(saved());
  const view = await render(
    <StartupQueries enabled={false} scope={identity} allowCache={allowCache}>
      <Probe />
    </StartupQueries>,
  );
  expect(view.getByText('loading:empty:waiting')).toBeTruthy();
  expect(mockQuery.mock.calls.every(([, args]) => args === 'skip')).toBe(true);
});

it('restores a confirmed session, replaces it with fresh data, and saves later live updates', async () => {
  jest.useFakeTimers();
  try {
    const snapshot = saved();
    jest.mocked(startupSnapshotStore.read).mockResolvedValue(snapshot);
    const tree = (enabled: boolean) => (
      <StartupQueries enabled={enabled} scope={scope} allowCache>
        <Probe />
      </StartupQueries>
    );
    const view = await render(tree(false));
    expect(view.getByText('saved:Saved title:waiting')).toBeTruthy();
    const responses: Record<string, unknown> = {
      profile: { ...snapshot.data.profile, username: 'fresh' },
      items: [{ title: 'Fresh title' }],
      settings: snapshot.data.settings,
      stats: snapshot.data.stats,
      tags: [],
      requests: [],
    };
    mockQuery.mockImplementation((query, args) => (args === 'skip' ? undefined : responses[query]));
    await view.rerender(tree(true));
    expect(view.getByText('fresh:Fresh title:fresh')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(500));
    expect(startupSnapshotStore.save).toHaveBeenLastCalledWith(
      scope,
      expect.objectContaining({ items: [{ title: 'Fresh title' }] }),
    );
    responses.items = [{ title: 'Updated title' }];
    await view.rerender(tree(true));
    await act(() => jest.advanceTimersByTime(500));
    expect(view.getByText('fresh:Updated title:fresh')).toBeTruthy();
    expect(startupSnapshotStore.save).toHaveBeenLastCalledWith(
      scope,
      expect.objectContaining({ items: [{ title: 'Updated title' }] }),
    );
    await view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('drops saved content immediately on sign-out, account changes, and cache expiry', async () => {
  jest.useFakeTimers();
  try {
    const snapshot = saved();
    snapshot.savedAt -= 24 * 60 * 60 * 1000 - 1000;
    jest.mocked(startupSnapshotStore.read).mockResolvedValue(snapshot);
    const tree = (identity = scope, allowCache = true) => (
      <StartupQueries enabled={false} scope={identity} allowCache={allowCache}>
        <Probe />
      </StartupQueries>
    );
    const view = await render(tree());
    expect(view.getByText('saved:Saved title:waiting')).toBeTruthy();
    await view.rerender(tree(scope, false));
    expect(view.getByText('loading:empty:waiting')).toBeTruthy();
    await view.rerender(tree({ ...scope, userId: 'user_b' }));
    expect(view.getByText('loading:empty:waiting')).toBeTruthy();
    await view.rerender(tree());
    expect(view.getByText('saved:Saved title:waiting')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(1001));
    expect(view.getByText('loading:empty:waiting')).toBeTruthy();
    await view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('does not request account data until authentication and account linking are ready', async () => {
  await render(<StartupQueries enabled={false} />);
  expect(mockQuery.mock.calls).toHaveLength(6);
  expect(mockQuery.mock.calls.every(([, args]) => args === 'skip')).toBe(true);
  expect(mockPrefetch).not.toHaveBeenCalled();
});

it('starts both screens together without waiting for the profile response or tab mount', async () => {
  await render(<StartupQueries enabled />);
  expect(mockQuery.mock.calls).toEqual([
    ['profile', {}],
    ['items', {}],
    ['settings', {}],
    ['stats', {}],
    ['tags', {}],
    ['requests', {}],
  ]);
});

it('prefetches profile artwork once it arrives while keeping account queries live', async () => {
  mockQuery.mockImplementation((query) =>
    query === 'profile'
      ? { avatarUrl: 'https://example.com/avatar' }
      : query === 'stats'
        ? { favorites: [{ posterPath: '/poster.jpg' }, { posterPath: '/poster.jpg' }, {}] }
        : [],
  );
  const view = await render(<StartupQueries enabled />);
  expect(mockPrefetch).toHaveBeenCalledWith(
    ['https://example.com/avatar', 'https://image.tmdb.org/t/p/w342/poster.jpg'],
    'memory-disk',
  );
  mockQuery.mockClear();
  await view.rerender(<StartupQueries enabled={false} />);
  expect(mockQuery.mock.calls.every(([, args]) => args === 'skip')).toBe(true);
});
