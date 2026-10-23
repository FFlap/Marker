import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { ClientWriteSession } from "@marker/shared/clientOperations";
import { OperationSessionContext } from "../src/hooks/operation-session";

vi.unmock("../src/hooks/operation-session");

const session = new ClientWriteSession("a", () => "a");
function Session({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <OperationSessionContext value={session}>
        {children}
      </OperationSessionContext>
    </StrictMode>
  );
}

import { useOperation } from "../src/hooks/use-operation";

it("finishes accepted writes after unmount while suppressing obsolete UI callbacks", async () => {
  let resolve!: () => void;
  const request = new Promise<void>((done) => {
    resolve = done;
  });
  const nextStep = vi.fn<() => void>();
  const success = vi.fn<() => void>();
  const settled = vi.fn<() => void>();
  const { result, unmount } = renderHook(useOperation, { wrapper: Session });
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.write(
      Effect.promise(() => request).pipe(Effect.andThen(Effect.sync(nextStep))),
      { success, settled },
    );
  });
  unmount();
  resolve();
  await pending;
  expect(nextStep).toHaveBeenCalledOnce();
  expect(success).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
});

it("handles typed failures, runs finalizers, and reports callback defects without their contents", async () => {
  const failure = vi.fn<() => void>();
  const settled = vi.fn<() => void>();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { result } = renderHook(useOperation);
  await act(async () => {
    await result.current(Effect.fail("expected"), { failure, settled });
  });
  expect(failure).toHaveBeenCalledWith("expected");
  expect(settled).toHaveBeenCalledTimes(1);
  expect(log).not.toHaveBeenCalled();
  await act(async () => {
    await result.current(Effect.void, {
      success: () => {
        throw new Error("sensitive");
      },
      settled,
    });
  });
  expect(log).toHaveBeenCalledWith("Unexpected client operation failure");
  expect(settled).toHaveBeenCalledTimes(2);
  log.mockRestore();
});

const liveClerk = vi.hoisted(() => ({
  session: { id: "original" },
  addListener: (_listener: () => void) => () => undefined,
}));
vi.mock("@clerk/react", () => ({
  useClerk: () => liveClerk,
  useAuth: () => ({ sessionId: "original" }),
}));

it("uses live Clerk identity to fence a detached continuation before React receives the account change", async () => {
  const { OperationSessionProvider } =
    await import("../src/hooks/operation-session");
  const { saveLibrary } = await import("@marker/shared/clientEffects");
  let finish!: () => void;
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const next = vi.fn<() => Promise<void>>(async () => undefined);
  const success = vi.fn<() => void>();
  const { result, unmount } = renderHook(useOperation, {
    wrapper: OperationSessionProvider,
  });
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.write(
      Effect.gen(function* () {
        yield* saveLibrary(() => first);
        yield* saveLibrary(next);
      }),
      { success },
    );
  });
  unmount();
  liveClerk.session = { id: "different-account" };
  finish();
  await pending;
  expect(next).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
});
