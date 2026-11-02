import { createContext, useContext } from 'react';
import { getFunctionName, type FunctionReference, type FunctionReturnType } from 'convex/server';
import { useQuery, type OptionalRestArgsOrSkip } from 'convex/react';

export const StartupDataContext = createContext<{
  values: Record<string, unknown>;
  cached: boolean;
  fresh: boolean;
} | null>(null);

/** The startup provider owns these live subscriptions and their session-scoped fallback. */
export function useStartupQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const startup = useContext(StartupDataContext);
  const name = startup ? getFunctionName(query) : '';
  const owned = !!startup && Object.hasOwn(startup.values, name);
  const live = useQuery(query, ...((owned ? ['skip'] : args) as OptionalRestArgsOrSkip<Query>));
  if (args[0] === 'skip') return undefined;
  return owned ? (startup.values[name] as FunctionReturnType<Query> | undefined) : live;
}

export const useStartupData = () => useContext(StartupDataContext);
