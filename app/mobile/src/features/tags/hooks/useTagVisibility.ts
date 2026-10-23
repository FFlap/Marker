import { Effect } from 'effect';
import { saveProfile } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import { useToast } from '@/components/ui/Toast';

export function useTagVisibility(tag: string) {
  const runOperation = useOperation();
  const visibility = useQuery(api.tags.visibility, tag ? { tag } : 'skip');
  const setVisibility = useMutation(api.tags.setVisibility);
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const loading = !tag || visibility === undefined;

  const update = async (isPublic: boolean) => {
    if (!tag || visibility === undefined || pending || visibility.isPublic === isPublic) return;
    setPending(true);
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveProfile(() => setVisibility({ tag, isPublic }));
      }),
      {
        success: () => {
          toast.show(isPublic ? 'Tag added to Explore and your profile' : 'Tag is now private');
        },

        failure: () => {
          toast.show('Couldn’t update tag visibility');
        },
        settled: () => {
          setPending(false);
        },
      },
    );
  };

  return { isPublic: visibility?.isPublic === true, loading, pending, update };
}
