import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { Image } from 'expo-image';
import { api } from '@marker/shared/api';
import { StartupDataContext } from '@/hooks/useStartupQuery';
import {
  snapshotMatches,
  SNAPSHOT_MAX_AGE_MS,
  type SnapshotScope,
  type StartupSnapshot,
} from '@/lib/startupSnapshot';
import { startupSnapshotStore } from '@/lib/startupSnapshotStorage';

/** Keep both initial screens subscribed, so account/profile/library are not a request waterfall. */
export function StartupQueries({
  enabled,
  scope,
  allowCache = false,
  children,
}: {
  enabled: boolean;
  scope?: SnapshotScope;
  allowCache?: boolean;
  children?: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<StartupSnapshot | null>(null);
  const scopeKey = scope ? JSON.stringify(scope) : undefined;
  useEffect(() => {
    let active = true;
    void startupSnapshotStore.read().then((value) => {
      if (active) setSnapshot(value);
    });
    return () => {
      active = false;
    };
  }, [scopeKey]);
  useEffect(() => {
    if (!snapshot) return;
    const timer = setTimeout(
      () => setSnapshot(null),
      Math.max(0, snapshot.savedAt + SNAPSHOT_MAX_AGE_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [snapshot]);
  const args = enabled ? {} : 'skip';
  const profile = useQuery(api.profiles.me, args);
  const items = useQuery(api.library.items.listItems, args);
  const settings = useQuery(api.settings.getSettings, args);
  const stats = useQuery(api.stats.profile, args);
  const tags = useQuery(api.tags.myPublic, args);
  const requests = useQuery(api.profiles.followRequests, args);
  const ready =
    enabled &&
    [profile, items, settings, stats, tags, requests].every((value) => value !== undefined);
  const cached = allowCache && !ready && snapshotMatches(snapshot, scope) ? snapshot.data : null;
  useEffect(() => {
    if (
      !enabled ||
      !scope ||
      !profile?.username ||
      !items ||
      !settings ||
      !stats ||
      !tags ||
      !requests
    )
      return;
    // Save server-acknowledged values only. Debounce subsequent live updates off the draw path.
    const timer = setTimeout(() => {
      void startupSnapshotStore.save(scope, { profile, items, settings, stats, tags, requests });
    }, 500);
    return () => clearTimeout(timer);
  }, [enabled, scopeKey, scope, profile, items, settings, stats, tags, requests]);
  const displayedProfile = cached?.profile ?? profile;
  const displayedStats = cached?.stats ?? stats;
  useEffect(() => {
    if (!enabled && !cached) return;
    const posters =
      displayedStats?.favorites.flatMap((favorite) =>
        favorite.posterPath ? [`https://image.tmdb.org/t/p/w342${favorite.posterPath}`] : [],
      ) ?? [];
    const sources = [
      ...new Set([
        ...(displayedProfile?.avatarUrl ? [displayedProfile.avatarUrl] : []),
        ...posters,
      ]),
    ];
    if (sources.length) void Image.prefetch(sources, 'memory-disk').catch(() => undefined);
  }, [enabled, cached, displayedProfile?.avatarUrl, displayedStats?.favorites]);
  const value = useMemo(
    () => ({
      cached: !!cached,
      fresh: ready,
      values: {
        [getFunctionName(api.profiles.me)]: cached?.profile ?? profile,
        [getFunctionName(api.library.items.listItems)]: cached?.items ?? items,
        [getFunctionName(api.settings.getSettings)]: cached?.settings ?? settings,
        [getFunctionName(api.stats.profile)]: cached?.stats ?? stats,
        [getFunctionName(api.tags.myPublic)]: cached?.tags ?? tags,
        [getFunctionName(api.profiles.followRequests)]: cached?.requests ?? requests,
      },
    }),
    [cached, ready, profile, items, settings, stats, tags, requests],
  );
  return <StartupDataContext value={value}>{children}</StartupDataContext>;
}
