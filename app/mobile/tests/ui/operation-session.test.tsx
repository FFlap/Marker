import React, { StrictMode } from 'react';
import { act, render } from '@testing-library/react-native';
import { Effect } from 'effect';
import { saveLibrary } from '@marker/shared/clientEffects';
import { OperationSessionProvider } from '@/hooks/operation-session';
import { useOperation } from '@/hooks/use-operation';

jest.unmock('../../src/hooks/operation-session');

const mockClerk = {
  session: { id: 'session_a' },
  addListener: jest.fn((_listener: () => void) => jest.fn()),
};
jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ sessionId: 'session_a' }),
  useClerk: () => mockClerk,
}));

beforeEach(() => {
  mockClerk.session = { id: 'session_a' };
  mockClerk.addListener.mockClear();
});

async function startWrite() {
  let run!: ReturnType<typeof useOperation>;
  function Screen() {
    run = useOperation();
    return null;
  }
  const view = await render(
    <StrictMode>
      <OperationSessionProvider>
        <Screen />
      </OperationSessionProvider>
    </StrictMode>,
  );
  let finish!: () => void;
  const first = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const continuation = jest.fn().mockResolvedValue(undefined);
  const observer = jest.fn();
  let pending!: Promise<void>;
  await act(async () => {
    pending = run.write(
      Effect.gen(function* () {
        yield* saveLibrary(first);
        yield* saveLibrary(continuation);
      }),
      { success: observer, settled: observer },
    );
  });
  expect(first).toHaveBeenCalledTimes(1);
  return { view, finish, pending, continuation, observer };
}

it('finishes an accepted write after unmount without updating the obsolete screen', async () => {
  const write = await startWrite();
  await write.view.unmount();
  await act(async () => {
    write.finish();
    await write.pending;
  });
  expect(write.continuation).toHaveBeenCalledTimes(1);
  expect(write.observer).not.toHaveBeenCalled();
});

it('checks live Clerk identity before a continuation even before React rerenders', async () => {
  const write = await startWrite();
  mockClerk.session = { id: 'session_b' };
  await act(async () => {
    write.finish();
    await write.pending;
  });
  expect(write.continuation).not.toHaveBeenCalled();
  expect(write.observer).not.toHaveBeenCalled();
});

it('keeps a session invalid after Clerk changes away and back', async () => {
  const write = await startWrite();
  const listener = mockClerk.addListener.mock.calls.at(-1)![0];
  mockClerk.session = { id: 'session_b' };
  listener();
  mockClerk.session = { id: 'session_a' };
  listener();
  await act(async () => {
    write.finish();
    await write.pending;
  });
  expect(write.continuation).not.toHaveBeenCalled();
  expect(write.observer).not.toHaveBeenCalled();
});
