import { describe, expect, it } from 'vitest';
import {
  transitionAsync,
  transitionAuthScreen,
  transitionTask,
  transitionOwner,
  transitionSession,
  transitionPresence,
  accountAccess,
  transitionPendingTasks,
  orderLifecycle,
} from '../../lib/lifecycle';

describe('client lifecycle transitions', () => {
  it('ignores an obsolete completion after a new request starts', () => {
    const pending = transitionAsync<string, string>(
      { state: 'idle' },
      { type: 'start', version: 2 },
    );
    expect(transitionAsync(pending, { type: 'fail', version: 1, error: 'old failure' })).toBe(
      pending,
    );
    expect(transitionAsync(pending, { type: 'succeed', version: 2, value: 'current' })).toEqual({
      state: 'succeeded',
      version: 2,
      value: 'current',
    });
  });
  it('cannot retain recovery and verification at the same time', () => {
    const recovery = transitionAuthScreen(
      { state: 'form', flow: 'signIn' },
      { type: 'recover', stage: 'password' },
    );
    const verification = transitionAuthScreen(recovery, {
      type: 'verify',
      verification: 'clientTrust',
    });
    expect(verification).toEqual({
      state: 'verification',
      flow: 'signIn',
      verification: 'clientTrust',
    });
    expect(transitionAuthScreen(verification, { type: 'recover', stage: null })).toEqual(
      verification,
    );
    expect(transitionAuthScreen(verification, { type: 'choose', flow: 'signUp' })).toEqual({
      state: 'form',
      flow: 'signUp',
    });
  });
  it('preserves a submit failure when finally settles the operation', () => {
    const pending = transitionTask({ state: 'idle' }, { type: 'start' });
    expect(transitionTask(pending, { type: 'clearFailure' })).toEqual(pending);
    const failed = transitionTask(pending, { type: 'fail', error: 'Try again' });
    expect(failed.state).toBe('pending');
    expect(transitionTask(failed, { type: 'finish' })).toEqual({
      state: 'failed',
      error: 'Try again',
    });
    expect(transitionTask(failed, { type: 'start' })).toEqual({
      state: 'pending',
      error: 'Try again',
    });
  });
  it('reactivation cannot revive a disposed generation or an invalid write session', () => {
    const active = { state: 'active' as const, generation: 0 };
    expect(transitionOwner(transitionOwner(active, 'dispose'), 'activate')).toEqual({
      state: 'active',
      generation: 1,
    });
    expect(transitionSession(transitionSession({ state: 'current' }, false), true)).toEqual({
      state: 'invalidated',
    });
  });
  it('reopening during close restores an interactive presence', () => {
    expect(transitionPresence(transitionPresence({ state: 'open' }, 'close'), 'open')).toEqual({
      state: 'open',
    });
  });
  it('does not grant access until both provisioning and the profile have loaded', () => {
    const auth = {
      isLoading: false,
      isAuthenticated: true,
      accountReady: false,
      accountError: false,
      profileLoaded: false,
      hasUsername: false,
    };
    expect(accountAccess(auth).state).toBe('loading');
    expect(accountAccess({ ...auth, accountReady: true, profileLoaded: true }).state).toBe(
      'setupRequired',
    );
    expect(accountAccess({ ...auth, isAuthenticated: false }).state).toBe('signedOut');
  });
  it('settles concurrent keys independently and holds optimistic order until acknowledgment', () => {
    const first = transitionPendingTasks({ state: 'idle' }, { type: 'start', key: 'a' });
    const both = transitionPendingTasks(first, { type: 'start', key: 'b' });
    const remaining = transitionPendingTasks(both, { type: 'finish', key: 'a' });
    expect(remaining.state === 'pending' ? [...remaining.keys] : []).toEqual(['b']);
    expect(orderLifecycle(['b', 'a'], ['a', 'b'], 2).state).toBe('saving');
    expect(orderLifecycle(['b', 'a'], ['a', 'b']).state).toBe('awaitingAcknowledgment');
    expect(orderLifecycle(['b', 'a'], ['b', 'new', 'a']).state).toBe('acknowledged');
  });
});
