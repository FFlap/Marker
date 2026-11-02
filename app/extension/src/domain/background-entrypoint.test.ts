import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthClient } from "./background";
import { runExtension } from "./effects";

const mocks = vi.hoisted(() => ({
  createClerkClient: vi.fn(),
  createMessageHandler: vi.fn(),
}));
vi.mock("@clerk/chrome-extension/client", () => ({
  createClerkClient: mocks.createClerkClient,
}));
vi.mock("./background", () => ({
  createMessageHandler: mocks.createMessageHandler,
}));
vi.mock("../config", () => ({
  CLERK_PUBLISHABLE_KEY: "test-key",
  CLERK_SYNC_HOST: "https://marker.example.com",
  CONVEX_SITE_URL: "https://marker.example.com",
  WEBSITE_URL: "https://marker.example.com",
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("defineBackground", (init: () => void) => init);
  vi.stubGlobal("browser", {
    storage: { local: {} },
    runtime: { onMessage: { addListener: vi.fn() } },
    alarms: { onAlarm: { addListener: vi.fn() } },
  });
  mocks.createMessageHandler.mockReturnValue({
    handler: vi.fn(),
    flush: vi.fn(async () => true),
    alarmFired: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("background Clerk session boundary", () => {
  it.each(["unchanged", "new user", "new session"] as const)(
    "checks the active Clerk identity after token refresh: %s",
    async (transition) => {
      let resolveToken!: (token: string) => void;
      const token = new Promise<string>((resolve) => { resolveToken = resolve; });
      const session = { getToken: vi.fn(() => token) };
      const clerk = {
        session,
        user: { id: "viewer", username: "viewer" },
        addListener: vi.fn(),
      };
      mocks.createClerkClient.mockResolvedValue(clerk);
      const entrypoint = await import("../../entrypoints/background");
      (entrypoint.default as unknown as () => void)();
      const client = mocks.createMessageHandler.mock.calls[0]![1] as AuthClient;
      const current = client.getSession();
      const reading = runExtension(current);
      await vi.waitFor(() => expect(session.getToken).toHaveBeenCalledOnce());
      if (transition === "new user") clerk.user = { id: "other", username: "other" };
      if (transition === "new session") clerk.session = { getToken: vi.fn() };
      resolveToken("test-token");
      await expect(reading).resolves.toEqual(
        transition === "unchanged"
          ? { token: "test-token", accountId: "viewer", accountLabel: "@viewer" }
          : null,
      );
    },
  );
});
