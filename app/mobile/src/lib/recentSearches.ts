import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** The old device-wide file; never read again, only removed. */
const LEGACY_FILENAME = 'marker-recent-searches-v1.json';
export const RECENT_SEARCH_LIMIT = 8;

type Stored = { searches: string[] };

// One file per account, so a session that ends without "Sign out" (expired or revoked)
// can't show its searches to whoever signs in next on this device.
const file = (userId: string) =>
  new File(Paths.document, `marker-recent-searches-v2-${encodeURIComponent(userId)}.json`);

/** Recent Explore searches of the signed-in account on this device. */
export async function readRecentSearches(userId: string | null | undefined): Promise<string[]> {
  if (Platform.OS === 'web' || !userId) return [];
  try {
    const stored = file(userId);
    if (!stored.exists) return [];
    const value = JSON.parse(await stored.text()) as Partial<Stored>;
    return Array.isArray(value.searches)
      ? value.searches.filter((entry) => typeof entry === 'string').slice(0, RECENT_SEARCH_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function writeRecentSearches(userId: string | null | undefined, searches: string[]) {
  if (Platform.OS === 'web' || !userId) return;
  try {
    file(userId).write(JSON.stringify({ searches } satisfies Stored));
  } catch {
    // Recent searches are a convenience; failing to save them is not worth interrupting.
  }
}

/** Signing out forgets that account's recent searches (and the old shared file). */
export function clearRecentSearches(userId: string | null | undefined) {
  if (Platform.OS === 'web') return;
  for (const stored of [
    new File(Paths.document, LEGACY_FILENAME),
    ...(userId ? [file(userId)] : []),
  ]) {
    try {
      if (stored.exists) stored.delete();
    } catch {
      // Nothing to clear.
    }
  }
}

/** Newest first, one entry per query regardless of case, capped. */
export function withRecentSearch(searches: readonly string[], query: string) {
  const value = query.trim().replace(/\s+/g, ' ');
  if (value.length < 2) return [...searches];
  const key = value.toLocaleLowerCase();
  return [value, ...searches.filter((entry) => entry.toLocaleLowerCase() !== key)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  );
}

/** Brings back cleared searches behind any made since, one entry per query, capped. */
export function restoredRecentSearches(current: readonly string[], cleared: readonly string[]) {
  const seen = new Set(current.map((entry) => entry.toLocaleLowerCase()));
  return [
    ...current,
    ...cleared.filter((entry) => {
      const key = entry.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ].slice(0, RECENT_SEARCH_LIMIT);
}
