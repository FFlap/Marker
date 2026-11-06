/** Small, dependency-free machines shared by native, web and backend code.
 * Effects stay with their owner; transitions are synchronous and inspectable.
 */
export type AsyncState<A = void, E = string> =
  | { state: 'idle' }
  | { state: 'pending'; version: number }
  | { state: 'succeeded'; version: number; value: A }
  | { state: 'failed'; version: number; error: E };

export type AsyncEvent<A, E> =
  | { type: 'start'; version: number }
  | { type: 'succeed'; version: number; value: A }
  | { type: 'fail'; version: number; error: E }
  | { type: 'reset' };

export function transitionAsync<A, E>(
  current: AsyncState<A, E>,
  event: AsyncEvent<A, E>,
): AsyncState<A, E> {
  switch (event.type) {
    case 'reset':
      return { state: 'idle' };
    case 'start':
      return { state: 'pending', version: event.version };
    case 'succeed':
      return current.state === 'pending' && current.version === event.version
        ? { state: 'succeeded', version: event.version, value: event.value }
        : current;
    case 'fail':
      return current.state === 'pending' && current.version === event.version
        ? { state: 'failed', version: event.version, error: event.error }
        : current;
  }
}

export type AuthFlow = 'choose' | 'signIn' | 'signUp';
export type RecoveryStage = 'identifier' | 'code' | 'password';
export type AuthScreen =
  | { state: 'form'; flow: AuthFlow }
  | { state: 'verification'; flow: AuthFlow; verification: 'signUp' | 'clientTrust' }
  | { state: 'recovery'; flow: AuthFlow; stage: RecoveryStage };
export type AuthScreenEvent =
  | { type: 'choose'; flow: AuthFlow }
  | { type: 'verify'; verification: 'signUp' | 'clientTrust' | null }
  | { type: 'recover'; stage: RecoveryStage | null };

export function transitionAuthScreen(current: AuthScreen, event: AuthScreenEvent): AuthScreen {
  switch (event.type) {
    case 'choose':
      return { state: 'form', flow: event.flow };
    case 'verify':
      return event.verification
        ? { state: 'verification', flow: current.flow, verification: event.verification }
        : current.state === 'verification'
          ? { state: 'form', flow: current.flow }
          : current;
    case 'recover':
      return event.stage
        ? { state: 'recovery', flow: current.flow, stage: event.stage }
        : current.state === 'recovery'
          ? { state: 'form', flow: current.flow }
          : current;
  }
}

export type OwnedState =
  { state: 'active'; generation: number } | { state: 'disposed'; generation: number };
export function transitionOwner(current: OwnedState, event: 'activate' | 'dispose'): OwnedState {
  return event === 'dispose'
    ? { state: 'disposed', generation: current.generation + 1 }
    : { state: 'active', generation: current.generation };
}

export type SessionState = { state: 'current' } | { state: 'invalidated' };
export function transitionSession(current: SessionState, matches: boolean): SessionState {
  return current.state === 'invalidated' || !matches ? { state: 'invalidated' } : current;
}

export type PresenceState = { state: 'closed' } | { state: 'open' } | { state: 'closing' };
export function transitionPresence(
  current: PresenceState,
  event: 'open' | 'close' | 'closed',
): PresenceState {
  switch (event) {
    case 'open':
      return { state: 'open' };
    case 'close':
      return current.state === 'closed' ? current : { state: 'closing' };
    case 'closed':
      return { state: 'closed' };
  }
}

export type AccountAccess =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'signedOut' }
  | { state: 'setupRequired' }
  | { state: 'ready' };
export function accountAccess(input: {
  isLoading: boolean;
  isAuthenticated: boolean;
  accountReady: boolean;
  accountError: boolean;
  profileLoaded: boolean;
  hasUsername: boolean;
}): AccountAccess {
  if (input.accountError) return { state: 'error' };
  if (input.isLoading || (input.isAuthenticated && (!input.accountReady || !input.profileLoaded)))
    return { state: 'loading' };
  if (!input.isAuthenticated) return { state: 'signedOut' };
  return { state: input.hasUsername ? 'ready' : 'setupRequired' };
}

export type StartupState<A> =
  { state: 'loading' } | { state: 'cached'; data: A } | { state: 'live' };
export function startupState<A>(live: boolean, cached: A | null): StartupState<A> {
  return live
    ? { state: 'live' }
    : cached
      ? { state: 'cached', data: cached }
      : { state: 'loading' };
}

export type DraftState<A> = { state: 'clean' | 'dirty' | 'submitted'; draft: A };
export function transitionDraft<A>(
  current: DraftState<A>,
  event: { type: 'edit'; update: (value: A) => A } | { type: 'submit' },
): DraftState<A> {
  switch (event.type) {
    case 'edit':
      return { state: 'dirty', draft: event.update(current.draft) };
    case 'submit':
      return { ...current, state: 'submitted' };
  }
}

export type TaskState =
  { state: 'idle' } | { state: 'pending'; error: string } | { state: 'failed'; error: string };
export type TaskEvent =
  { type: 'start' | 'finish' | 'clearFailure' } | { type: 'fail'; error: string };
export function transitionTask(current: TaskState, event: TaskEvent): TaskState {
  switch (event.type) {
    case 'start':
      return { state: 'pending', error: current.state === 'idle' ? '' : current.error };
    case 'finish':
      return current.state === 'pending'
        ? current.error
          ? { state: 'failed', error: current.error }
          : { state: 'idle' }
        : current;
    case 'clearFailure':
      return current.state === 'pending' ? { state: 'pending', error: '' } : { state: 'idle' };
    // A UI error does not release an in-flight owner. Finally/finish does that.
    case 'fail':
      return { state: current.state === 'pending' ? 'pending' : 'failed', error: event.error };
  }
}

export type OrderLifecycle =
  | { state: 'saved' }
  | { state: 'saving'; order: readonly string[]; version: number }
  | { state: 'awaitingAcknowledgment'; order: readonly string[] }
  | { state: 'acknowledged'; order: readonly string[] };
export function orderLifecycle(
  order: readonly string[] | undefined,
  saved: readonly string[],
  pendingVersion?: number,
): OrderLifecycle {
  if (!order) return { state: 'saved' };
  if (pendingVersion !== undefined) return { state: 'saving', order, version: pendingVersion };
  const positions = new Map(order.map((id, index) => [id, index]));
  let previous = -1;
  for (const id of saved) {
    const position = positions.get(id);
    if (position === undefined) continue;
    if (position <= previous) return { state: 'awaitingAcknowledgment', order };
    previous = position;
  }
  return { state: 'acknowledged', order };
}

export type CollectionPagination<A> =
  { state: 'initial' } | { state: 'continuation'; cursor: string; pages: A[] };
export function advanceCollection<A>(
  current: CollectionPagination<A>,
  page: A,
  cursor: string,
): CollectionPagination<A> {
  return {
    state: 'continuation',
    cursor,
    pages: [...(current.state === 'initial' ? [] : current.pages), page],
  };
}

export type PendingTasks = { state: 'idle' } | { state: 'pending'; keys: ReadonlySet<string> };
export type PendingTasksEvent = { type: 'start' | 'finish'; key: string };
export function transitionPendingTasks(
  current: PendingTasks,
  event: PendingTasksEvent,
): PendingTasks {
  const keys = new Set(current.state === 'pending' ? current.keys : []);
  if (event.type === 'start') keys.add(event.key);
  else keys.delete(event.key);
  return keys.size ? { state: 'pending', keys } : { state: 'idle' };
}
