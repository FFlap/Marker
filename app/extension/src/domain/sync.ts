import type { EpisodeBookmark } from "./types";

export interface WatchPayload {
  service: "crunchyroll" | "netflix";
  seriesTitle: string;
  seasonTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  url?: string;
}

export type SyncResult = Record<string, unknown> & {
  ok: boolean;
  retryable: boolean;
  error?: string;
};
export const SYNC_ACCOUNT_KEY = "sync.accountId";
export const SYNC_OUTBOX_KEY = "sync.outbox";
export const SYNC_RETRY_KEY = "sync.outboxRetry";
export const SYNC_RETRY_ALARM = "sync.outboxRetry";
export const SYNC_LAST_RESULT_KEY = "sync.lastResult";
export const SYNC_OUTBOX_MAX = 20;
const TEXT_MAX = 300;
const URL_MAX = 1_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000] as const;
interface RetryState { attempt: number; nextRetryAt: number }
export interface AlarmScheduler {
  schedule(name: string, when: number): Promise<void> | void;
  clear(name: string): Promise<void> | void;
}
export interface SyncStorage {
  get(key: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(key: string): Promise<void>;
}

export function buildWatchPayload(
  bookmark: EpisodeBookmark,
): WatchPayload | null {
  const seriesTitle = bookmark.seriesTitle.trim();
  const rawSeason = bookmark.seasonNumber;
  const episodeTitle = bookmark.episodeTitle.trim();
  const specials = /^specials?$/i.test(rawSeason.trim());
  const cleanInteger = (value: string) =>
    /^\d+$/.test(value.trim()) ? Number(value) : undefined;
  const seasonNumber = specials ? 0 : cleanInteger(rawSeason);
  const seasonTitle =
    !specials && seasonNumber === undefined ? rawSeason.trim() : undefined;
  const episodeNumber = cleanInteger(bookmark.episodeNumber);
  const reliableNumbers = seasonNumber !== undefined && episodeNumber !== undefined && !(specials && episodeTitle);
  if (rawSeason.trim().length > TEXT_MAX) return null;
  return parseWatchPayload({
    service: bookmark.platform,
    seriesTitle,
    ...(seasonTitle ? { seasonTitle } : {}),
    ...(reliableNumbers ? { seasonNumber, episodeNumber } : episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(episodeTitle ? { episodeTitle } : {}),
    url: bookmark.watchUrl,
  });
}

export function parseWatchPayload(value: unknown): WatchPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "service",
    "seriesTitle",
    "seasonTitle",
    "seasonNumber",
    "episodeNumber",
    "episodeTitle",
    "url",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return null;
  const service =
    input.service === "crunchyroll" || input.service === "netflix"
      ? input.service
      : undefined;
  const seriesTitle = typeof input.seriesTitle === "string" ? input.seriesTitle.trim() : "";
  const seasonTitle = typeof input.seasonTitle === "string" ? input.seasonTitle.trim() : undefined;
  const seasonNumber =
    typeof input.seasonNumber === "number" &&
    Number.isInteger(input.seasonNumber) &&
    input.seasonNumber >= 0
      ? input.seasonNumber
      : undefined;
  const episodeNumber =
    typeof input.episodeNumber === "number" &&
    Number.isInteger(input.episodeNumber) &&
    input.episodeNumber >= 0
      ? input.episodeNumber
      : undefined;
  const episodeTitle = typeof input.episodeTitle === "string" ? input.episodeTitle.trim() : undefined;
  const url = typeof input.url === "string" ? input.url.trim() : undefined;
  if (
    !service ||
    !seriesTitle ||
    seriesTitle.length > TEXT_MAX ||
    (seasonTitle && seasonTitle.length > TEXT_MAX) ||
    (episodeTitle && episodeTitle.length > TEXT_MAX) ||
    (seasonNumber === undefined || episodeNumber === undefined) && !episodeTitle
  ) return null;
  if (url) {
    try {
      const parsed = new URL(url);
      if (url.length > URL_MAX || (parsed.protocol !== "https:" && parsed.protocol !== "http:"))
        return null;
    } catch {
      return null;
    }
  }
  return {
    service,
    seriesTitle,
    ...(seasonTitle ? { seasonTitle } : {}),
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(episodeTitle ? { episodeTitle } : {}),
    ...(url ? { url } : {}),
  };
}

const normalizeIdentity = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();
const sameEpisode = (left: WatchPayload, right: WatchPayload) => {
  if (
    left.service !== right.service ||
    normalizeIdentity(left.seriesTitle) !== normalizeIdentity(right.seriesTitle) ||
    normalizeIdentity(left.seasonTitle ?? "") !==
      normalizeIdentity(right.seasonTitle ?? "")
  ) return false;
  if (left.seasonNumber !== undefined && right.seasonNumber !== undefined) {
    if (left.seasonNumber !== right.seasonNumber) return false;
    if (left.episodeNumber !== undefined && right.episodeNumber !== undefined)
      return left.episodeNumber === right.episodeNumber;
  }
  return Boolean(
    left.episodeTitle && right.episodeTitle &&
    normalizeIdentity(left.episodeTitle) === normalizeIdentity(right.episodeTitle),
  );
};

function normalizeOutbox(value: unknown): WatchPayload[] {
  if (!Array.isArray(value)) return [];
  const normalized: WatchPayload[] = [];
  for (const entry of value) {
    const payload = parseWatchPayload(entry);
    if (payload) normalized.push(payload);
  }
  return normalized;
}

async function enqueueWatchEvent(
  storage: SyncStorage,
  payload: WatchPayload,
): Promise<void> {
  const stored = await storage.get(SYNC_OUTBOX_KEY);
  const current = normalizeOutbox(stored[SYNC_OUTBOX_KEY]);
  const deduped = current.filter((entry) => !sameEpisode(entry, payload));
  await storage.set({
    [SYNC_OUTBOX_KEY]: [...deduped, payload].slice(-SYNC_OUTBOX_MAX),
  });
}

async function flushWatchOutbox(
  storage: SyncStorage,
  post: (payload: WatchPayload, accountId?: string) => Promise<SyncResult>,
  serialize: <T>(operation: () => Promise<T>, prepare?: boolean) => Promise<T>,
  isCurrent: () => boolean,
): Promise<void> {
  const stored = await serialize(() =>
    storage.get([SYNC_OUTBOX_KEY, SYNC_ACCOUNT_KEY]),
  );
  const outbox = normalizeOutbox(stored[SYNC_OUTBOX_KEY]);
  const storedOutbox = stored[SYNC_OUTBOX_KEY];
  const droppedInvalid = Array.isArray(storedOutbox) && storedOutbox.length !== outbox.length;
  let sent = 0;
  for (const payload of outbox) {
    if (!isCurrent()) break;
    let result: SyncResult;
    try {
      const accountId = stored[SYNC_ACCOUNT_KEY];
      result = typeof accountId === "string"
        ? await post(payload, accountId)
        : await post(payload);
    } catch {
      break;
    }
    if (result.retryable) break;
    sent += 1;
  }
  await serialize(async () => {
    const latestStored = await storage.get([SYNC_OUTBOX_KEY, SYNC_ACCOUNT_KEY]);
    if (
      !isCurrent() ||
      stored[SYNC_ACCOUNT_KEY] !== latestStored[SYNC_ACCOUNT_KEY] ||
      !(sent > 0 || droppedInvalid)
    ) return;
    const latest = normalizeOutbox(latestStored[SYNC_OUTBOX_KEY]);
    const delivered = new Set(
      outbox.slice(0, sent).map((payload) => JSON.stringify(payload)),
    );
    await storage.set({
      [SYNC_OUTBOX_KEY]: latest.filter(
        (entry) => !delivered.has(JSON.stringify(entry)),
      ),
    });
  }, false);
}

export function createOutboxManager(
  storage: SyncStorage,
  post: (payload: WatchPayload, accountId?: string) => Promise<SyncResult>,
  options: {
    now?: () => number;
    alarms?: AlarmScheduler;
    prepare?: () => Promise<void>;
  } = {},
) {
  const now = options.now ?? Date.now;
  let operations = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>, prepare = true) => {
    const result = operations.then(async () => {
      if (prepare) await options.prepare?.();
      return operation();
    });
    operations = result.then(() => undefined, () => undefined);
    return result;
  };
  const updateSchedule = async (complete: boolean, resetAttempt = false) => {
    if (complete) {
      await storage.set({ [SYNC_RETRY_KEY]: null });
      await options.alarms?.clear(SYNC_RETRY_ALARM);
      return;
    }
    const stored = await storage.get(SYNC_RETRY_KEY);
    const previous = stored[SYNC_RETRY_KEY] as Partial<RetryState> | null;
    const attempt =
      resetAttempt
        ? 0
        : typeof previous?.attempt === "number"
          ? Math.max(1, previous.attempt + 1)
          : 1;
    const delay = RETRY_DELAYS_MS[
      Math.min(Math.max(0, attempt - 1), RETRY_DELAYS_MS.length - 1)
    ]!;
    const retry = { attempt, nextRetryAt: now() + delay };
    await storage.set({ [SYNC_RETRY_KEY]: retry });
    await options.alarms?.schedule(SYNC_RETRY_ALARM, retry.nextRetryAt);
  };
  let generation = 0;
  let flushing: Promise<boolean> | undefined;
  const flush = () => {
    if (flushing) return flushing;
    const currentGeneration = generation;
    flushing = (async () => {
      await flushWatchOutbox(
        storage, post, serialize, () => currentGeneration === generation,
      );
      return serialize(async () => {
        const stored = await storage.get(SYNC_OUTBOX_KEY);
        const complete = normalizeOutbox(stored[SYNC_OUTBOX_KEY]).length === 0;
        if (currentGeneration === generation) await updateSchedule(complete);
        return complete;
      }, false);
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };
  const clear = () =>
    serialize(async () => {
      generation += 1;
      if (storage.remove) {
        await storage.remove(SYNC_OUTBOX_KEY);
        await storage.remove(SYNC_RETRY_KEY);
      } else {
        await storage.set({
          [SYNC_OUTBOX_KEY]: null,
          [SYNC_RETRY_KEY]: null,
        });
      }
      await options.alarms?.clear(SYNC_RETRY_ALARM);
    }, false);
  return {
    clear,
    flush,
    async alarmFired() {
      const stored = await storage.get(SYNC_RETRY_KEY);
      const retry = stored[SYNC_RETRY_KEY] as Partial<RetryState> | null;
      if (typeof retry?.nextRetryAt !== "number" || retry.nextRetryAt > now()) return false;
      return flush();
    },
    enqueue(payload: WatchPayload) {
      return serialize(async () => {
        await enqueueWatchEvent(storage, payload);
        await updateSchedule(false, true);
      });
    },
  };
}
