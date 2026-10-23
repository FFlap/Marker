import { Effect } from "effect";
import { external } from "../src/domain/effects";
import { createWatchTransportEffect } from "../src/domain/http";
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

  const getSession = Effect.fn("getSession")(function* () {
      const clerk = yield* external("auth.client", () => clerkPromise);
      const session = clerk.session;
      const user = clerk.user;
      if (!session || !user) return null;
      const token = yield* external("auth.token", () =>
        session.getToken(),
      ).pipe(Effect.catchTag("ExtensionFailure", () => Effect.succeed(null)));
      if (!token || clerk.session !== session || clerk.user?.id !== user.id)
        return null;
      const accountLabel = user.username
        ? `@${user.username}`
        : (user.primaryEmailAddress?.emailAddress ?? "Marker account");
      return { token, accountId: user.id, accountLabel };
    });
  const recordWatch = createWatchTransportEffect(
    `${CONVEX_SITE_URL}/extension/watch`,
  );

  const background = createMessageHandler(
    browser.storage.local,
    {
      getSession,
      connect: Effect.fn("connect")(function* () {
          const url = new URL("/extension/connect", WEBSITE_URL);
          url.searchParams.set("next", "/extension/connect");
          yield* external("tabs.create", () =>
            browser.tabs.create({ url: url.toString() }),
          );
        }),
      signOut: Effect.fn("signOut")(function* () {
          const clerk = yield* external("auth.client", () => clerkPromise);
          yield* external("auth.signOut", () => clerk.signOut());
        }),
      record: recordWatch,
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
      void background
        .handler(message)
        .then(sendResponse)
        .catch(() => {
          console.error("[Marker] Background message failed");
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
      void background
        .alarmFired()
        .catch(() => console.error("[Marker] Outbox alarm failed"));
  });
  void clerkPromise
    .then((clerk) => {
      let accountId = clerk.user?.id;
      clerk.addListener(() => {
        const nextAccountId = clerk.user?.id;
        if (nextAccountId === accountId) return;
        accountId = nextAccountId;
        void background
          .flush()
          .catch(() => console.error("[Marker] Account sync failed"));
      });
      return background.flush();
    })
    .catch(() => console.error("[Marker] Background initialization failed"));
});
