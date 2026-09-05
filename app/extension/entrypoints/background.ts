import { createClerkClient } from "@clerk/chrome-extension/client";
import {
  CLERK_PUBLISHABLE_KEY,
  CLERK_SYNC_HOST,
  CONVEX_SITE_URL,
  WEBSITE_URL,
} from "../src/config";
import { createMessageHandler } from "../src/domain/background";
import { SYNC_RETRY_ALARM } from "../src/domain/sync";

export default defineBackground(() => {
  const clerkPromise = createClerkClient({
    publishableKey: CLERK_PUBLISHABLE_KEY,
    syncHost: CLERK_SYNC_HOST,
    background: true,
  });

  const getSession = async () => {
    const clerk = await clerkPromise;
    const session = clerk.session;
    const user = clerk.user;
    if (!session || !user) return null;
    let token: string | null;
    try {
      token = await session.getToken();
    } catch {
      return null;
    }
    if (!token) return null;
    const accountLabel = user.username
      ? `@${user.username}`
      : (user.primaryEmailAddress?.emailAddress ?? "Marker account");
    return { token, accountId: user.id, accountLabel };
  };

  const authenticatedPost = async (
    path: string,
    token: string,
    body?: unknown,
  ) => {
    const response = await fetch(`${CONVEX_SITE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "Authentication required"
          : "Sync request failed",
      );
      Object.assign(error, { status: response.status });
      throw error;
    }
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      const error = new Error("Sync returned an invalid response");
      Object.assign(error, { status: 502 });
      throw error;
    }
  };

  const background = createMessageHandler(
    browser.storage.local,
    {
      getSession,
      connect: async () => {
        const url = new URL("/extension/connect", WEBSITE_URL);
        url.searchParams.set("next", "/extension/connect");
        await browser.tabs.create({ url: url.toString() });
      },
      signOut: async () => (await clerkPromise).signOut(),
      record: (token, payload) =>
        authenticatedPost("/extension/watch", token, payload),
    },
    {
      alarms: {
        schedule: (name, when) => browser.alarms.create(name, { when }),
        clear: (name) => browser.alarms.clear(name).then(() => undefined),
      },
    },
  );

  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      void background.handler(message).then(sendResponse).catch(() => {
        sendResponse({
          ok: false,
          reason: "background-error",
          retryable: true,
        });
      });
      return true;
    },
  );
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_RETRY_ALARM)
      void background.alarmFired().catch(() => undefined);
  });
  void clerkPromise
    .then((clerk) => {
      let accountId = clerk.user?.id;
      clerk.addListener(() => {
        const nextAccountId = clerk.user?.id;
        if (nextAccountId === accountId) return;
        accountId = nextAccountId;
        void background.flush().catch(() => undefined);
      });
      return background.flush();
    })
    .catch(() => undefined);
});
