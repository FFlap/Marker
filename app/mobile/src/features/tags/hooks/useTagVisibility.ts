import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useToast } from '@/components/ui/Toast';

export function useTagVisibility(tag: string) {
  const visibility = useQuery(api.tags.visibility, tag ? { tag } : 'skip');
  const setVisibility = useMutation(api.tags.setVisibility);
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const loading = !tag || visibility === undefined;

  const update = async (isPublic: boolean) => {
    if (!tag || visibility === undefined || pending || visibility.isPublic === isPublic) return;
    setPending(true);
    try {
      await setVisibility({ tag, isPublic });
      toast.show(isPublic ? 'Tag added to Explore and your profile' : 'Tag is now private');
    } catch {
      toast.show('Couldn’t update tag visibility');
    } finally {
      setPending(false);
    }
  };

  return { isPublic: visibility?.isPublic === true, loading, pending, update };
}
