import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let reducedMotion = false;
const listeners = new Set<() => void>();
let stopListening: (() => void) | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let active = true;
    let receivedEvent = false;
    const update = (enabled: boolean) => {
      if (!active || reducedMotion === enabled) return;
      reducedMotion = enabled;
      listeners.forEach((notify) => notify());
    };
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      receivedEvent = true;
      update(enabled);
    });
    // Events take precedence over the pending initial read. The active guard
    // also prevents an old request from updating a new subscription session.
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (!receivedEvent) update(enabled);
      },
      () => undefined,
    );
    stopListening = () => {
      active = false;
      subscription.remove();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };
}

const getSnapshot = () => reducedMotion;
const getServerSnapshot = () => false;

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
