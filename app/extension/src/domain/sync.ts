import { Clock, Effect, Predicate, Schema } from "effect";
import {
  ExtensionStorage,
  createFifo,
  operation,
  external,
  runExtension,
  storageService,
  type ExtensionFailure,
} from "./effects";
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

export interface SyncResult {
  ok: boolean;
  retryable: boolean;
  reason?: string;
  unverified?: boolean;
}
export const SYNC_ACCOUNT_KEY = "sync.accountId";
export const SYNC_OUTBOX_KEY = "sync.outbox";
export const SYNC_RETRY_KEY = "sync.outboxRetry";
export const SYNC_RETRY_ALARM = "sync.outboxRetry";
export const SYNC_LAST_RESULT_KEY = "sync.lastResult";
export const SYNC_OUTBOX_MAX = 20;
const TEXT_MAX = 300;
const URL_MAX = 1_000;
const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  6 * 60 * 60_000,
] as const;
interface RetryState {
  attempt: number;
  nextRetryAt: number;
}
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
  const reliableNumbers =
    seasonNumber !== undefined &&
    episodeNumber !== undefined &&
    !(specials && episodeTitle);
  if (rawSeason.trim().length > TEXT_MAX) return null;
  return parseWatchPayload({
    service: bookmark.platform,
    seriesTitle,
    ...(seasonTitle ? { seasonTitle } : {}),
    ...(reliableNumbers
      ? { seasonNumber, episodeNumber }
      : episodeNumber !== undefined
        ? { episodeNumber }
        : {}),
    ...(episodeTitle ? { episodeTitle } : {}),
    url: bookmark.watchUrl,
  });
}

export function parseWatchPayload(value: unknown): WatchPayload | null {
  if (!Predicate.isObjectOrArray(value)) return null;
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
  const seriesTitle =
    typeof input.seriesTitle === "string" ? input.seriesTitle.trim() : "";
  const seasonTitle =
    typeof input.seasonTitle === "string"
      ? input.seasonTitle.trim()
      : undefined;
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
  const episodeTitle =
    typeof input.episodeTitle === "string"
      ? input.episodeTitle.trim()
      : undefined;
  const url = typeof input.url === "string" ? input.url.trim() : undefined;
  if (
    !service ||
    !seriesTitle ||
    seriesTitle.length > TEXT_MAX ||
    (seasonTitle && seasonTitle.length > TEXT_MAX) ||
    (episodeTitle && episodeTitle.length > TEXT_MAX) ||
    ((seasonNumber === undefined || episodeNumber === undefined) &&
      !episodeTitle)
  )
    return null;
  if (url) {
    try {
      const parsed = new URL(url);
      if (
        url.length > URL_MAX ||
        (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      )
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
    normalizeIdentity(left.seriesTitle) !==
      normalizeIdentity(right.seriesTitle) ||
    normalizeIdentity(left.seasonTitle ?? "") !==
      normalizeIdentity(right.seasonTitle ?? "")
  )
    return false;
  if (left.seasonNumber !== undefined && right.seasonNumber !== undefined) {
    if (left.seasonNumber !== right.seasonNumber) return false;
    if (left.episodeNumber !== undefined && right.episodeNumber !== undefined)
      return left.episodeNumber === right.episodeNumber;
  }
  return Boolean(
    left.episodeTitle &&
      right.episodeTitle &&
      normalizeIdentity(left.episodeTitle) ===
        normalizeIdentity(right.episodeTitle),
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

const RetrySchema = Schema.Struct({
  attempt: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
  nextRetryAt: Schema.Finite,
});
const retryState = (value: unknown): RetryState | null =>
  Schema.is(RetrySchema)(value) ? value : null;

/** The FIFO queue protects storage read/modify/write, never the network request.
 * Persistence + chrome.alarms, rather than an in-memory retry schedule, survive MV3 suspension.
 * Writers run to completion: Chrome storage writes cannot be aborted safely mid-transaction.
 */
export function createOutboxManager(
  storage: SyncStorage,
  post: (
    payload: WatchPayload,
    accountId?: string,
  ) => Promise<SyncResult> | Effect.Effect<SyncResult, ExtensionFailure>,
  options: {
    now?: () => number;
    alarms?: AlarmScheduler;
    prepare?: () => Promise<void> | Effect.Effect<void, ExtensionFailure>;
  } = {},
) {
  const now = options.now ? Effect.sync(options.now) : Clock.currentTimeMillis;
  const service = storageService(storage);
  const fifo = createFifo();
  const provide = <A>(
    effect: Effect.Effect<A, ExtensionFailure, ExtensionStorage>,
  ) => effect.pipe(Effect.provideService(ExtensionStorage, service));
  const serialize = Effect.fnUntraced(function* <A>(
    task: Effect.Effect<A, ExtensionFailure, ExtensionStorage>,
    prepare = true,
  ) {
    if (prepare && options.prepare)
      yield* operation("sync.prepare", options.prepare);
    return yield* task;
  }, fifo);
  const alarm = (action: "clear" | "schedule", when = 0) =>
    external("alarm." + action, async () => {
      if (action === "clear") await options.alarms?.clear(SYNC_RETRY_ALARM);
      else await options.alarms?.schedule(SYNC_RETRY_ALARM, when);
    });
  const updateSchedule = Effect.fnUntraced(function* (
    complete: boolean,
    resetAttempt = false,
  ) {
    const db = yield* ExtensionStorage;
    if (complete) {
      yield* db.set({ [SYNC_RETRY_KEY]: null });
      yield* alarm("clear");
      return;
    }
    const stored = yield* db.get(SYNC_RETRY_KEY);
    const previous = retryState(stored[SYNC_RETRY_KEY]);
    const attempt = resetAttempt
      ? 0
      : previous
        ? Math.max(1, previous.attempt + 1)
        : 1;
    const delay =
      RETRY_DELAYS_MS[
        Math.min(Math.max(0, attempt - 1), RETRY_DELAYS_MS.length - 1)
      ]!;
    const retry = { attempt, nextRetryAt: (yield* now) + delay };
    yield* db.set({ [SYNC_RETRY_KEY]: retry });
    yield* alarm("schedule", retry.nextRetryAt);
  });
  let generation = 0;
  let flushing: Effect.Effect<boolean, ExtensionFailure> | undefined;
  const flushEffect = Effect.gen(function* () {
    if (flushing) return yield* flushing;
    const currentGeneration = generation;
    const isCurrent = () => currentGeneration === generation;
    const batch = provide(
      Effect.gen(function* () {
        const db = yield* ExtensionStorage;
        const stored = yield* serialize(
          db.get([SYNC_OUTBOX_KEY, SYNC_ACCOUNT_KEY]),
        );
        const outbox = normalizeOutbox(stored[SYNC_OUTBOX_KEY]);
        const raw = stored[SYNC_OUTBOX_KEY];
        const droppedInvalid =
          Array.isArray(raw) && raw.length !== outbox.length;
        let sent = 0;
        for (const payload of outbox) {
          if (!isCurrent()) break;
          const account = stored[SYNC_ACCOUNT_KEY];
          // Typed integration failures retry; defects propagate after persisting the retry schedule.
          const result = yield* operation("sync.post", () =>
            typeof account === "string"
              ? post(payload, account)
              : post(payload),
          ).pipe(
            Effect.catchTag("ExtensionFailure", () =>
              Effect.succeed({ ok: false, retryable: true }),
            ),
          );
          if (result.retryable) break;
          sent += 1;
        }
        yield* serialize(
          Effect.gen(function* () {
            const latestStored = yield* db.get([
              SYNC_OUTBOX_KEY,
              SYNC_ACCOUNT_KEY,
            ]);
            if (
              !isCurrent() ||
              stored[SYNC_ACCOUNT_KEY] !== latestStored[SYNC_ACCOUNT_KEY] ||
              !(sent > 0 || droppedInvalid)
            )
              return;
            const delivered = new Set(
              outbox.slice(0, sent).map((payload) => JSON.stringify(payload)),
            );
            yield* db.set({
              [SYNC_OUTBOX_KEY]: normalizeOutbox(
                latestStored[SYNC_OUTBOX_KEY],
              ).filter((entry) => !delivered.has(JSON.stringify(entry))),
            });
          }),
          false,
        );
        return yield* serialize(
          Effect.gen(function* () {
            const latest = yield* db.get(SYNC_OUTBOX_KEY);
            const complete =
              normalizeOutbox(latest[SYNC_OUTBOX_KEY]).length === 0;
            if (isCurrent()) yield* updateSchedule(complete);
            return complete;
          }),
          false,
        );
      }).pipe(
        Effect.onError(() =>
          serialize(
            Effect.suspend(() =>
              isCurrent() ? updateSchedule(false) : Effect.void,
            ),
            false,
          ).pipe(Effect.catch(() => Effect.void)),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            flushing = undefined;
          }),
        ),
      ),
    );
    flushing = yield* Effect.cached(batch);
    return yield* flushing;
  });
  const effects = {
    flush: flushEffect,
    clear: Effect.fnUntraced(
      function* () {
        generation += 1;
        const db = yield* ExtensionStorage;
        yield* db.remove(SYNC_OUTBOX_KEY);
        yield* db.remove(SYNC_RETRY_KEY);
        yield* alarm("clear");
      },
      (effect) => serialize(effect, false),
      provide,
    ),
    alarmFired: Effect.fnUntraced(function* () {
      const db = yield* ExtensionStorage;
      const stored = yield* db.get(SYNC_RETRY_KEY);
      const retry = retryState(stored[SYNC_RETRY_KEY]);
      if (!retry || retry.nextRetryAt > (yield* now)) return false;
      return yield* flushEffect;
    }, provide),
    enqueue: Effect.fnUntraced(
      function* (payload: WatchPayload) {
        const parsed = parseWatchPayload(payload);
        if (!parsed) return;
        const db = yield* ExtensionStorage;
        const stored = yield* db.get(SYNC_OUTBOX_KEY);
        const deduped = normalizeOutbox(stored[SYNC_OUTBOX_KEY]).filter(
          (entry) => !sameEpisode(entry, parsed),
        );
        yield* db.set({
          [SYNC_OUTBOX_KEY]: [...deduped, parsed].slice(-SYNC_OUTBOX_MAX),
        });
        yield* updateSchedule(false, true);
      },
      (effect) => serialize(effect),
      provide,
    ),
  };
  return {
    effects,
    flush: () => runExtension(effects.flush),
    clear: () => runExtension(effects.clear()),
    alarmFired: () => runExtension(effects.alarmFired()),
    enqueue: (payload: WatchPayload) => runExtension(effects.enqueue(payload)),
  };
}
