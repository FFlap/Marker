import { useEffect, useMemo } from "react";
import { ClientOperations } from "@marker/shared/clientOperations";
import { useWriteSession } from "./operation-session";

/** Read work belongs to the view; accepted writes belong to its auth session. */
export function useOperation() {
  const session = useWriteSession();
  const operations = useMemo(() => new ClientOperations(session), [session]);
  useEffect(() => {
    operations.activate();
    return () => operations.dispose();
  }, [operations]);
  return useMemo(
    () => Object.assign(operations.run, { write: operations.write }),
    [operations],
  );
}
