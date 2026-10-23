import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useAuth, useClerk } from '@clerk/expo';
import { ClientWriteSession } from '@marker/shared/clientOperations';

export const OperationSessionContext = createContext<ClientWriteSession | undefined>(undefined);
export function OperationSessionProvider({ children }: { children: ReactNode }) {
  const clerk = useClerk();
  const { sessionId } = useAuth();
  const session = useMemo(
    () => new ClientWriteSession(sessionId ?? null, () => clerk.session?.id ?? null),
    [clerk, sessionId],
  );
  useEffect(
    () =>
      clerk.addListener(() => {
        session.isCurrent();
      }),
    [clerk, session],
  );
  return <OperationSessionContext value={session}>{children}</OperationSessionContext>;
}
export const useWriteSession = () => useContext(OperationSessionContext);
