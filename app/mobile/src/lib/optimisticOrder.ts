import { orderLifecycle } from '@marker/shared/lifecycle';

export function isOrderAcknowledged(
  optimistic: readonly string[],
  saved: readonly string[],
  pendingVersion?: number,
) {
  return orderLifecycle(optimistic, saved, pendingVersion).state === 'acknowledged';
}
