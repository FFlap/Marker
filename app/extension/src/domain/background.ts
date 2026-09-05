import {
  createBookmarkOperations,
  validateBookmark,
} from "./bookmarks";
import type { EpisodeBookmark } from "./types";
import { BOOKMARKS_STORAGE_KEY } from "../messages";
import {
  createOutboxManager,
  buildWatchPayload,
  SYNC_ACCOUNT_KEY,
  parseWatchPayload,
  SYNC_LAST_RESULT_KEY,
  SYNC_OUTBOX_KEY,
  SYNC_RETRY_KEY,
  type AlarmScheduler,
  type SyncResult,
  type SyncStorage,
  type WatchPayload,
} from "./sync";

export type BackgroundMessage =
  | { type: "sync/connect" }
  | { type: "sync/signOut" }
  | { type: "sync/status" }
  | { type: "sync/enqueue"; payload: WatchPayload }
  | { type: "sync/unsupported"; seriesTitle: string }
  | { type: "sync/flushNow" }
  | { type: "bookmark/save"; bookmark: EpisodeBookmark }
  | { type: "bookmark/remove"; key: string }
  | { type: "bookmark/clear" };

type ErrorLike = {
  data?: { code?: unknown };
  status?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
};
export type DeliveryClassification = "retryable" | "auth" | "terminal";

export interface AuthClient {
  getSession(): Promise<{ token: string; accountId: string; accountLabel: string } | null>;
  connect(): Promise<void>;
  signOut(): Promise<void>;
  record(token: string, payload: Record<string, unknown>): Promise<unknown>;
}

export function classifyDeliveryError(error: unknown): DeliveryClassification {
  const value = error as ErrorLike | null;
  if (value?.data?.code === "upstream") return "retryable";
  const status = Number(value?.status);
  const code = String(value?.data?.code ?? value?.code ?? "").toLowerCase();
  const message = String(value?.message ?? "").toLowerCase();
  const authCodes = new Set([
    "auth",
    "authentication_required",
    "invalid_token",
    "session_expired",
    "unauthorized",
  ]);
  if (
    status === 401 ||
    status === 403 ||
    authCodes.has(code) ||
    /token refresh|authentication required|unauthoriz/.test(message)
  )
    return "auth";
  if (status >= 500) return "retryable";
  if (value?.name === "AbortError" || /timeout|timed out/.test(message))
    return "retryable";
  if (
    error instanceof TypeError &&
    /fetch|network|load failed|offline/.test(message)
  )
    return "retryable";
  return "terminal";
}

function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "sync/connect":
    case "sync/signOut":
    case "sync/status":
    case "sync/flushNow":
    case "bookmark/clear":
      return true;
    case "sync/enqueue":
      return typeof message.payload === "object" && message.payload !== null;
    case "sync/unsupported":
      return (
        typeof message.seriesTitle === "string" &&
        Boolean(message.seriesTitle.trim()) &&
        message.seriesTitle.length <= 300
      );
    case "bookmark/save":
      return typeof message.bookmark === "object" && message.bookmark !== null;
    case "bookmark/remove":
      return typeof message.key === "string";
    default:
      return false;
  }
}

export function createMessageHandler(
  storage: SyncStorage & { remove(key: string): Promise<void> },
  client: AuthClient,
  options: { now?: () => number; alarms?: AlarmScheduler } = {},
) {
  let accountRevision = 0;
  const deliver = async (payload: WatchPayload, accountId?: string): Promise<SyncResult> => {
    const revision = accountRevision;
    const current = await client.getSession();
    if (!current || (accountId !== undefined && current.accountId !== accountId))
      return { ok: false, reason: "not-signed-in", retryable: true };
    const stored = await storage.get(SYNC_ACCOUNT_KEY);
    if (stored[SYNC_ACCOUNT_KEY] && stored[SYNC_ACCOUNT_KEY] !== current.accountId)
      return { ok: false, reason: "not-signed-in", retryable: true };
    try {
      const result = (await client.record(current.token, { ...payload })) as {
        ok?: unknown;
        reason?: unknown;
        unverified?: unknown;
      };
      return await recordResult(
        result.ok === true
          ? {
              ok: true,
              retryable: false,
              ...(result.unverified === true ? { unverified: true } : {}),
            }
          : {
              ok: false,
              reason:
                typeof result.reason === "string" ? result.reason : "rejected",
              retryable: false,
            },
        payload.seriesTitle,
        revision,
      );
    } catch (error) {
      const classification = classifyDeliveryError(error);
      const result: SyncResult =
        classification === "auth"
          ? { ok: false, reason: "not-signed-in", retryable: true }
          :
          classification === "retryable"
            ? { ok: false, retryable: true }
            : { ok: false, reason: "rejected", retryable: false };
      return recordResult(result, payload.seriesTitle, revision);
    }
  };
  const recordResult = async (result: SyncResult, seriesTitle?: string, revision?: number) => {
    if (revision !== undefined && revision !== accountRevision) return result;
    await storage.set({
      [SYNC_LAST_RESULT_KEY]: {
        ok: result.ok,
        at: Date.now(),
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.unverified === true ? { unverified: true } : {}),
        ...(seriesTitle ? { seriesTitle } : {}),
      },
    });
    return result;
  };
  const outbox = createOutboxManager(storage, deliver, {
    ...options,
    prepare: async () => {
      const current = await client.getSession();
      if (!current) return;
      const stored = await storage.get(SYNC_ACCOUNT_KEY);
      const previous = stored[SYNC_ACCOUNT_KEY];
      if (previous === current.accountId) return;
      accountRevision += 1;
      if (previous) {
        await storage.remove(SYNC_OUTBOX_KEY);
        await storage.remove(SYNC_RETRY_KEY);
        await storage.remove(SYNC_LAST_RESULT_KEY);
      }
      await storage.set({ [SYNC_ACCOUNT_KEY]: current.accountId });
    },
  });
  const bookmarks = createBookmarkOperations(storage, BOOKMARKS_STORAGE_KEY);
  const handler = async (message: unknown) => {
    if (!isBackgroundMessage(message))
      return { ok: false, reason: "invalid-message", retryable: false };
    switch (message.type) {
      case "sync/connect": {
        try {
          await client.connect();
          const signedIn = await client.getSession();
          if (signedIn) await outbox.flush();
          return signedIn
            ? { signedIn: true, accountLabel: signedIn.accountLabel }
            : { signedIn: false, reason: "sign-in-opened" };
        } catch (error) {
          return {
            signedIn: false,
            reason: error instanceof Error ? error.message : "connect-failed",
          };
        }
      }
      case "sync/signOut":
        accountRevision += 1;
        await client.signOut();
        await outbox.clear();
        await storage.remove(SYNC_ACCOUNT_KEY);
        await storage.remove(SYNC_LAST_RESULT_KEY);
        return { signedIn: false };
      case "sync/status": {
        const current = await client.getSession();
        return current
          ? { signedIn: true, accountLabel: current.accountLabel }
          : { signedIn: false };
      }
      case "sync/enqueue": {
        const payload = parseWatchPayload(message.payload);
        if (!payload)
          return { ok: false, reason: "rejected", retryable: false };
        await outbox.enqueue(payload);
        await outbox.flush();
        return { ok: true };
      }
      case "sync/unsupported":
        return recordResult(
          { ok: false, reason: "unsupported-episode", retryable: false },
          message.seriesTitle.trim(),
        );
      case "sync/flushNow":
        await outbox.flush();
        return { ok: true };
      case "bookmark/save": {
        const bookmark = validateBookmark(message.bookmark);
        if (!bookmark) {
          const incoming = message.bookmark as unknown as Record<
            string,
            unknown
          >;
          const seriesTitle =
            typeof incoming.seriesTitle === "string" &&
            incoming.seriesTitle.trim() &&
            incoming.seriesTitle.length <= 300
              ? incoming.seriesTitle.trim()
              : undefined;
          await recordResult(
            { ok: false, reason: "unsupported-episode", retryable: false },
            seriesTitle,
          );
          return { changed: false, reason: "unsupported-episode" };
        }
        const changed = await bookmarks.save(bookmark);
        const payload = buildWatchPayload(bookmark);
        if (payload) {
          await outbox.enqueue(payload);
          void outbox.flush().catch(() => undefined);
        } else {
          await recordResult({ ok: false, reason: "unsupported-episode", retryable: false }, bookmark.seriesTitle);
        }
        return { changed };
      }
      case "bookmark/remove":
        await bookmarks.remove(message.key);
        return { ok: true };
      case "bookmark/clear":
        await bookmarks.clear();
        return { ok: true };
    }
  };
  return {
    handler,
    flush: outbox.flush,
    alarmFired: outbox.alarmFired,
    deliver,
  };
}
