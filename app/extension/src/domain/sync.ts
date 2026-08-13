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
  if (
    !seriesTitle ||
    seriesTitle.length > TEXT_MAX ||
    rawSeason.trim().length > TEXT_MAX ||
    episodeTitle.length > TEXT_MAX ||
    (!reliableNumbers && !episodeTitle)
  )
    return null;
  const candidateUrl = bookmark.watchUrl.trim();
  let url: string | undefined;
  if (candidateUrl) {
    try {
      const parsed = new URL(candidateUrl);
      if (
        candidateUrl.length > URL_MAX ||
        (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      ) return null;
      url = candidateUrl;
    } catch {
      return null;
    }
  }

  return {
    service: bookmark.platform,
    seriesTitle,
    ...(seasonTitle && seasonTitle.length <= TEXT_MAX ? { seasonTitle } : {}),
    ...(reliableNumbers ? { seasonNumber, episodeNumber } : episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(episodeTitle ? { episodeTitle } : {}),
    ...(url ? { url } : {}),
  };
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
const outboxKeys = (payload: WatchPayload) => {
  const prefix = `${payload.service}:${normalizeIdentity(payload.seriesTitle)}${
    payload.seasonTitle ? `:season-title:${normalizeIdentity(payload.seasonTitle)}` : ""
  }`;
  return [
    ...(payload.seasonNumber !== undefined && payload.episodeNumber !== undefined
      ? [`${prefix}:${payload.seasonNumber}:${payload.episodeNumber}`]
      : []),
    ...(payload.episodeTitle ? [`${prefix}:title:${normalizeIdentity(payload.episodeTitle)}`] : []),
  ];
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
  const keys = new Set(outboxKeys(payload));
  const deduped = current.filter((entry) => !outboxKeys(entry).some((key) => keys.has(key)));
  await storage.set({
    [SYNC_OUTBOX_KEY]: [...deduped, payload].slice(-SYNC_OUTBOX_MAX),
  });
}

async function flushWatchOutbox(
  storage: SyncStorage,
  post: (payload: WatchPayload) => Promise<SyncResult>,
): Promise<boolean> {
  const stored = await storage.get(SYNC_OUTBOX_KEY);
  const outbox = normalizeOutbox(stored[SYNC_OUTBOX_KEY]);
  const storedOutbox = stored[SYNC_OUTBOX_KEY];
  const droppedInvalid = Array.isArray(storedOutbox) && storedOutbox.length !== outbox.length;
  let sent = 0;
  for (const payload of outbox) {
    let result: SyncResult;
    try {
      result = await post(payload);
    } catch {
      break;
    }
    if (result.retryable) break;
    sent += 1;
  }
  if (sent > 0 || droppedInvalid) {
    const latestStored = await storage.get(SYNC_OUTBOX_KEY);
    const latest = normalizeOutbox(latestStored[SYNC_OUTBOX_KEY]);
    const deliveredKeys = new Set(outbox.slice(0, sent).flatMap(outboxKeys));
    await storage.set({
      [SYNC_OUTBOX_KEY]: latest.filter(
        (entry) => !outboxKeys(entry).some((key) => deliveredKeys.has(key)),
      ),
    });
  }
  return sent === outbox.length;
}

export function createOutboxManager(
  storage: SyncStorage,
  post: (payload: WatchPayload) => Promise<SyncResult>,
  options: { now?: () => number; alarms?: AlarmScheduler } = {},
) {
  const now = options.now ?? Date.now;
  let operations = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>) => {
    const result = operations.then(operation, operation);
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
      !resetAttempt && typeof previous?.attempt === "number"
        ? Math.max(1, previous.attempt + 1)
        : 1;
    const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
    const retry = { attempt, nextRetryAt: now() + delay };
    await storage.set({ [SYNC_RETRY_KEY]: retry });
    await options.alarms?.schedule(SYNC_RETRY_ALARM, retry.nextRetryAt);
  };
  const runFlush = async (resetAttempt = false) => {
    const complete = await flushWatchOutbox(storage, post);
    await updateSchedule(complete, resetAttempt);
    return complete;
  };
  const flush = () => serialize(runFlush);
  const clear = () =>
    serialize(async () => {
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
    });
  return {
    clear,
    flush,
    async alarmFired() {
      return serialize(async () => {
        const stored = await storage.get(SYNC_RETRY_KEY);
        const retry = stored[SYNC_RETRY_KEY] as Partial<RetryState> | null;
        if (typeof retry?.nextRetryAt !== "number" || retry.nextRetryAt > now()) return false;
        return runFlush();
      });
    },
    enqueue(payload: WatchPayload) {
      return serialize(async () => {
        await enqueueWatchEvent(storage, payload);
        await options.alarms?.clear(SYNC_RETRY_ALARM);
        return runFlush(true);
      });
    },
  };
}
