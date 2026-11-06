import { useCallback, useMemo, useState, type SetStateAction } from "react";
import {
  transitionPendingTasks,
  type PendingTasks,
} from "@marker/shared/lifecycle";

/** Independent per-key pending machines; finishing one key never unlocks another. */
export function usePendingTasks() {
  const [tasks, setTasks] = useState<PendingTasks>({ state: "idle" });
  const update = useCallback((action: SetStateAction<Set<string>>) => {
    setTasks((current) => {
      const before = new Set(current.state === "pending" ? current.keys : []);
      const after =
        typeof action === "function" ? action(new Set(before)) : action;
      let next = current;
      for (const key of before)
        if (!after.has(key))
          next = transitionPendingTasks(next, { type: "finish", key });
      for (const key of after)
        if (!before.has(key))
          next = transitionPendingTasks(next, { type: "start", key });
      return next;
    });
  }, []);
  const pending = useMemo(
    () => new Set(tasks.state === "pending" ? tasks.keys : []),
    [tasks],
  );
  return [pending, update] as const;
}
