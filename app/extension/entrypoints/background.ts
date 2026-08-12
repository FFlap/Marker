import { createClerkClient } from "@clerk/chrome-extension/client";
import {
  CLERK_PUBLISHABLE_KEY,
  CLERK_SYNC_HOST,
  CONVEX_SITE_URL,
  WEBSITE_URL,
} from "../src/config";
import { createMessageHandler } from "../src/domain/background";
import { SYNC_RETRY_ALARM } from "../src/domain/sync";

export default defineBackground(async () => {
  const clerk = await createClerkClient({
    publishableKey: CLERK_PUBLISHABLE_KEY,
    syncHost: CLERK_SYNC_HOST,
    background: true,
  });

  const getSession = async () => {
    const session = clerk.session;
    const user = clerk.user;
    if (!session || !user) return null;
    const token = await session.getToken();
    if (!token) return null;
    const accountLabel = user.username
      ? `@${user.username}`
      : (user.primaryEmailAddress?.emailAddress ?? "Marker account");
    return { token, accountLabel };
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
    return response.json() as Promise<Record<string, unknown>>;
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
      signOut: () => clerk.signOut(),
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

  browser.runtime.onMessage.addListener((message: unknown) =>
    background.handler(message),
  );
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_RETRY_ALARM) void background.alarmFired();
  });
  clerk.addListener(() => void background.flush());
  void background.flush();
});
