import * as Effect from 'effect/Effect';
import { afterEach, expect, it, vi } from 'vitest';
import { ClientOperations } from '../../lib/clientOperations';

afterEach(() => vi.restoreAllMocks());

it('handles expected failures and settles the operation once', async () => {
  const operations = new ClientOperations();
  const error = { _tag: 'Offline' };
  const failure = vi.fn();
  const settled = vi.fn();
  await operations.run(Effect.fail(error), { failure, settled });
  expect(failure).toHaveBeenCalledExactlyOnceWith(error);
  expect(settled).toHaveBeenCalledOnce();
});

it('releases interrupted work without publishing obsolete callbacks after reactivation', async () => {
  const operations = new ClientOperations();
  const released = vi.fn();
  const stale = { success: vi.fn(), failure: vi.fn(), settled: vi.fn() };
  const pending = operations.run(Effect.never.pipe(Effect.ensuring(Effect.sync(released))), stale);
  operations.dispose();
  operations.activate();
  const success = vi.fn();
  await operations.run(Effect.succeed('new lifetime'), { success });
  await pending;
  expect(released).toHaveBeenCalledOnce();
  expect(success).toHaveBeenCalledExactlyOnceWith('new lifetime');
  expect(stale.success).not.toHaveBeenCalled();
  expect(stale.failure).not.toHaveBeenCalled();
  expect(stale.settled).not.toHaveBeenCalled();
});

it('reports defects and unhandled typed errors without leaking their contents', async () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  const operations = new ClientOperations();
  const secret = new Error('sensitive SDK context');
  const settled = vi.fn();
  await operations.run(Effect.die(secret), { settled });
  await operations.run(Effect.fail(secret));
  await operations.run(Effect.succeed(null), {
    success: () => {
      throw secret;
    },
    settled,
  });
  expect(report).toHaveBeenCalledTimes(3);
  expect(report.mock.calls).toEqual(
    Array.from({ length: 3 }, () => ['Unexpected client operation failure']),
  );
  expect(settled).toHaveBeenCalledTimes(2);
});

it('does not start work after its owner has unmounted', async () => {
  const operations = new ClientOperations();
  const work = vi.fn();
  operations.dispose();
  await operations.run(Effect.sync(work));
  expect(work).not.toHaveBeenCalled();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('finishes accepted multi-step writes after unmount without reviving observers in StrictMode', async () => {
  const { ClientWriteSession } = await import('../../lib/clientOperations');
  const { saveLibrary } = await import('../../lib/clientEffects');
  const operations = new ClientOperations(new ClientWriteSession('a', () => 'a'));
  const first = deferred();
  const next = vi.fn(() => Promise.resolve());
  const handlers = { success: vi.fn(), failure: vi.fn(), settled: vi.fn() };
  const pending = operations.write(
    Effect.gen(function* () {
      yield* saveLibrary(() => first.promise);
      yield* saveLibrary(next);
    }),
    handlers,
  );
  operations.dispose();
  operations.activate();
  first.resolve();
  await pending;
  expect(next).toHaveBeenCalledOnce();
  for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
});

it('fences remaining native calls and callbacks when the live account changes before React cleanup', async () => {
  const { ClientWriteSession } = await import('../../lib/clientOperations');
  const { saveLibrary } = await import('../../lib/clientEffects');
  let identity = 'a';
  const scope = new ClientWriteSession(identity, () => identity);
  const operations = new ClientOperations(scope);
  const first = deferred();
  const next = vi.fn(() => Promise.resolve());
  const success = vi.fn();
  const pending = operations.write(
    Effect.gen(function* () {
      yield* saveLibrary(() => first.promise);
      yield* saveLibrary(next);
    }),
    { success },
  );
  identity = 'b';
  first.resolve();
  await pending;
  expect(next).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
  identity = 'a';
  await operations.write(saveLibrary(next));
  expect(next).not.toHaveBeenCalled();
});

it('preserves invocation order for queued accepted episode edits after unmount', async () => {
  const { ClientWriteSession } = await import('../../lib/clientOperations');
  const { saveLibrary } = await import('../../lib/clientEffects');
  const operations = new ClientOperations(new ClientWriteSession('a', () => 'a'));
  const first = deferred();
  const order: number[] = [];
  let tail = Promise.resolve();
  for (const value of [1, 2, 3]) {
    const previous = tail;
    tail = operations.write(
      Effect.promise(() => previous).pipe(
        Effect.andThen(
          saveLibrary(async () => {
            order.push(value);
            if (value === 1) await first.promise;
          }),
        ),
      ),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  operations.dispose();
  expect(order).toEqual([1]);
  first.resolve();
  await tail;
  expect(order).toEqual([1, 2, 3]);
});
